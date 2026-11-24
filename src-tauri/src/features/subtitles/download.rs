use std::path::PathBuf;
use std::time::Duration;
use uuid::Uuid;

fn sub_cache_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("harbor-subs");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn subtitle_extension(
    url: &str,
    content_type: Option<&str>,
    format_hint: Option<&str>,
    bytes: &[u8],
) -> &'static str {
    match format_hint
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "ass" | "ssa" => return "ass",
        "vtt" | "webvtt" => return "vtt",
        "srt" | "subrip" => return "srt",
        _ => {}
    }
    let head_len = bytes.len().min(1024);
    let head = String::from_utf8_lossy(&bytes[..head_len]).to_ascii_lowercase();
    if head.contains("[script info]")
        || head.contains("[v4+ styles]")
        || head.contains("[v4 styles]")
    {
        return "ass";
    }
    if head.trim_start_matches('\u{feff}').starts_with("webvtt") {
        return "vtt";
    }
    let lower = url.to_lowercase();
    if lower.ends_with(".vtt") || content_type.is_some_and(|c| c.contains("vtt")) {
        return "vtt";
    }
    if lower.ends_with(".ass") || lower.ends_with(".ssa") {
        return "ass";
    }
    "srt"
}

fn normalize_subtitle_bytes(
    bytes: &[u8],
    encoding_hint: Option<&str>,
    lang: Option<&str>,
) -> Vec<u8> {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.trim_start_matches('\u{feff}').as_bytes().to_vec();
    }

    let hinted =
        encoding_hint.and_then(|label| encoding_rs::Encoding::for_label(label.trim().as_bytes()));
    let language = lang.unwrap_or_default().trim().to_ascii_lowercase();
    let encoding = hinted.or_else(|| {
        if matches!(language.as_str(), "ar" | "ara" | "arabic") {
            encoding_rs::Encoding::for_label(b"windows-1256")
        } else {
            encoding_rs::Encoding::for_label(b"windows-1252")
        }
    });
    let Some(encoding) = encoding else {
        return String::from_utf8_lossy(bytes).into_owned().into_bytes();
    };
    let (text, _, _) = encoding.decode(bytes);
    text.trim_start_matches('\u{feff}').as_bytes().to_vec()
}

const SUBTITLE_NETWORK_LIMIT: usize = 12 * 1024 * 1024;
const SUBTITLE_ARCHIVE_LIMIT: u64 = 32 * 1024 * 1024;
const SUBTITLE_ENTRY_LIMIT: u64 = 4 * 1024 * 1024;
const SUBTITLE_ARCHIVE_ENTRIES: usize = 100;

fn is_zip_magic(bytes: &[u8]) -> bool {
    bytes.len() >= 4
        && (&bytes[..4] == b"PK\x03\x04"
            || &bytes[..4] == b"PK\x05\x06"
            || &bytes[..4] == b"PK\x07\x08")
}

fn extract_subtitle_from_zip(bytes: &[u8]) -> Result<Vec<u8>, String> {
    const SUB_EXTS: &[&str] = &["srt", "ass", "ssa", "vtt", "sub"];
    const ARCHIVE_EXTS: &[&str] = &["zip", "rar", "7z", "gz", "tgz", "bz2", "xz", "tar"];
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| "invalid subtitle archive".to_string())?;
    if archive.len() > SUBTITLE_ARCHIVE_ENTRIES {
        return Err("subtitle archive has too many entries".to_string());
    }
    let mut best: Option<(usize, u64, String)> = None;
    let mut total_size = 0u64;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|_| "invalid subtitle archive entry")?;
        let safe_path = entry
            .enclosed_name()
            .ok_or_else(|| "unsafe subtitle archive path".to_string())?;
        if safe_path.is_absolute() {
            return Err("unsafe absolute subtitle archive path".to_string());
        }
        if entry.is_dir() {
            continue;
        }
        total_size = total_size.saturating_add(entry.size());
        if total_size > SUBTITLE_ARCHIVE_LIMIT {
            return Err("subtitle archive inflated size limit exceeded".to_string());
        }
        let name = safe_path.to_string_lossy().to_ascii_lowercase();
        let ext = name.rsplit('.').next().unwrap_or("");
        if ARCHIVE_EXTS.contains(&ext) {
            return Err("nested subtitle archive rejected".to_string());
        }
        if SUB_EXTS.contains(&ext) {
            let size = entry.size();
            if size > SUBTITLE_ENTRY_LIMIT {
                return Err("subtitle archive entry size limit exceeded".to_string());
            }
            if best.as_ref().is_none_or(|(_, best_size, best_name)| {
                size > *best_size || (size == *best_size && name < *best_name)
            }) {
                best = Some((i, size, name));
            }
        }
    }
    let (idx, _, _) = best.ok_or_else(|| "subtitle archive is empty".to_string())?;
    let mut file = archive
        .by_index(idx)
        .map_err(|_| "invalid subtitle archive entry")?;
    let mut out = Vec::with_capacity(file.size() as usize);
    let mut limited = std::io::Read::take(&mut file, SUBTITLE_ENTRY_LIMIT + 1);
    std::io::Read::read_to_end(&mut limited, &mut out)
        .map_err(|_| "subtitle archive extraction failed".to_string())?;
    if out.len() as u64 > SUBTITLE_ENTRY_LIMIT {
        return Err("subtitle archive entry size limit exceeded".to_string());
    }
    if is_zip_magic(&out) {
        return Err("nested subtitle archive rejected".to_string());
    }
    Ok(out)
}

fn prepare_subtitle_download(
    url: &str,
    content_type: Option<&str>,
    format_hint: Option<&str>,
    encoding_hint: Option<&str>,
    lang: Option<&str>,
    bytes: &[u8],
) -> (&'static str, Vec<u8>) {
    let normalized = normalize_subtitle_bytes(bytes, encoding_hint, lang);
    let extension = subtitle_extension(url, content_type, format_hint, &normalized);
    (extension, normalized)
}

#[cfg(test)]
mod subtitle_download_tests {
    use super::{
        extract_subtitle_from_zip, normalize_subtitle_bytes, prepare_subtitle_download,
        subtitle_extension, SUBTITLE_ARCHIVE_ENTRIES,
    };
    use std::io::{Cursor, Write};

    fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut archive = zip::ZipWriter::new(&mut cursor);
            let options = zip::write::SimpleFileOptions::default();
            for (name, body) in entries {
                archive.start_file(*name, options).unwrap();
                archive.write_all(body).unwrap();
            }
            archive.finish().unwrap();
        }
        cursor.into_inner()
    }

    #[test]
    fn uses_explicit_ass_format_when_download_url_has_no_extension() {
        let body = b"[Script Info]\nTitle: Styled\n[V4+ Styles]\n";
        assert_eq!(
            subtitle_extension(
                "https://example.test/download?id=42",
                Some("application/octet-stream"),
                Some("ass"),
                body,
            ),
            "ass",
        );
    }

    #[test]
    fn detects_ass_from_content_when_provider_omits_format() {
        let body = b"[Script Info]\nTitle: Styled\n[V4+ Styles]\n";
        assert_eq!(
            subtitle_extension(
                "https://example.test/download?id=42",
                Some("text/plain"),
                None,
                body,
            ),
            "ass",
        );
    }

    #[test]
    fn converts_windows_1256_arabic_to_utf8() {
        let windows_1256 = [
            0xe3, 0xd1, 0xcd, 0xc8, 0xc7, 0x20, 0xc8, 0xc7, 0xe1, 0xda, 0xc7, 0xe1, 0xe3,
        ];
        let utf8 = normalize_subtitle_bytes(&windows_1256, Some("windows-1256"), Some("ar"));
        assert_eq!(String::from_utf8(utf8).unwrap(), "مرحبا بالعالم");
    }

    #[test]
    fn uses_arabic_language_as_legacy_encoding_fallback() {
        let windows_1256 = [
            0xe3, 0xd1, 0xcd, 0xc8, 0xc7, 0x20, 0xc8, 0xc7, 0xe1, 0xda, 0xc7, 0xe1, 0xe3,
        ];
        let utf8 = normalize_subtitle_bytes(&windows_1256, None, Some("ara"));
        assert_eq!(String::from_utf8(utf8).unwrap(), "مرحبا بالعالم");
    }

    #[test]
    fn converts_utf16_little_endian_bom_to_utf8() {
        let utf16 = [0xff, 0xfe, b'H', 0x00, b'i', 0x00];
        let utf8 = normalize_subtitle_bytes(&utf16, None, None);
        assert_eq!(String::from_utf8(utf8).unwrap(), "Hi");
    }

    #[test]
    fn detects_ass_after_utf16_normalization() {
        let text = "[Script Info]\nTitle: Styled\n";
        let mut utf16 = vec![0xff, 0xfe];
        for unit in text.encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        let normalized = normalize_subtitle_bytes(&utf16, None, None);
        assert_eq!(
            subtitle_extension("https://example.test/download", None, None, &normalized),
            "ass",
        );
    }

    #[test]
    fn download_preparation_detects_utf16_ass_before_writing() {
        let text = "[Script Info]\nTitle: Styled\n";
        let mut utf16 = vec![0xff, 0xfe];
        for unit in text.encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        let (extension, normalized) = prepare_subtitle_download(
            "https://example.test/download",
            None,
            None,
            None,
            None,
            &utf16,
        );
        assert_eq!(extension, "ass");
        assert_eq!(String::from_utf8(normalized).unwrap(), text);
    }

    #[test]
    fn safe_zip_rejects_traversal_and_nested_archives() {
        let traversal = make_zip(&[("../escape.srt", b"subtitle")]);
        assert!(extract_subtitle_from_zip(&traversal)
            .unwrap_err()
            .contains("unsafe subtitle archive path"));

        let nested = make_zip(&[("nested.zip", b"PK\x03\x04")]);
        assert!(extract_subtitle_from_zip(&nested)
            .unwrap_err()
            .contains("nested subtitle archive"));

        let disguised = make_zip(&[("nested.srt", b"PK\x03\x04")]);
        assert!(extract_subtitle_from_zip(&disguised)
            .unwrap_err()
            .contains("nested subtitle archive"));
    }

    #[test]
    fn safe_zip_caps_entries_and_requires_a_subtitle() {
        let names: Vec<String> = (0..=SUBTITLE_ARCHIVE_ENTRIES)
            .map(|index| format!("file-{index}.txt"))
            .collect();
        let entries: Vec<(&str, &[u8])> = names
            .iter()
            .map(|name| (name.as_str(), b"x".as_slice()))
            .collect();
        assert!(extract_subtitle_from_zip(&make_zip(&entries))
            .unwrap_err()
            .contains("too many entries"));

        let empty = make_zip(&[("readme.txt", b"nothing")]);
        assert!(extract_subtitle_from_zip(&empty)
            .unwrap_err()
            .contains("archive is empty"));
    }

    #[test]
    fn safe_zip_extracts_a_supported_subtitle_deterministically() {
        let archive = make_zip(&[("b.srt", b"large subtitle"), ("a.srt", b"large subtitle")]);
        assert_eq!(
            extract_subtitle_from_zip(&archive).unwrap(),
            b"large subtitle"
        );
    }
}

#[tauri::command]
pub async fn sub_download(
    url: String,
    format: Option<String>,
    encoding: Option<String>,
    lang: Option<String>,
) -> Result<String, String> {
    use std::io::Read;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .gzip(true)
        .build()
        .map_err(|e| format!("client: {}", e))?;
    let mut res = client
        .get(&url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        )
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("fetch: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("status {}", res.status()));
    }
    if res
        .content_length()
        .is_some_and(|size| size > SUBTITLE_NETWORK_LIMIT as u64)
    {
        return Err("subtitle download size limit exceeded".to_string());
    }
    let ct = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_lowercase());
    let mut raw = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("read: {}", e))? {
        if raw.len().saturating_add(chunk.len()) > SUBTITLE_NETWORK_LIMIT {
            return Err("subtitle download size limit exceeded".to_string());
        }
        raw.extend_from_slice(&chunk);
    }
    let was_gzip = raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b;
    let unpacked: Vec<u8> = if was_gzip {
        let mut decoder = flate2::read::GzDecoder::new(&raw[..]);
        let mut decoded = Vec::with_capacity(raw.len() * 4);
        std::io::Read::take(&mut decoder, SUBTITLE_ARCHIVE_LIMIT + 1)
            .read_to_end(&mut decoded)
            .map_err(|e| format!("gunzip: {}", e))?;
        if decoded.len() as u64 > SUBTITLE_ARCHIVE_LIMIT {
            return Err("subtitle archive inflated size limit exceeded".to_string());
        }
        decoded
    } else {
        raw.to_vec()
    };
    if was_gzip && is_zip_magic(&unpacked) {
        return Err("nested subtitle archive rejected".to_string());
    }
    let unpacked = if is_zip_magic(&unpacked) {
        extract_subtitle_from_zip(&unpacked)?
    } else {
        unpacked
    };
    let (ext, bytes) = prepare_subtitle_download(
        &url,
        ct.as_deref(),
        format.as_deref(),
        encoding.as_deref(),
        lang.as_deref(),
        &unpacked,
    );
    let id = Uuid::new_v4();
    let path = sub_cache_dir().join(format!("{}.{}", id, ext));
    std::fs::write(&path, &bytes).map_err(|e| format!("write: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}
