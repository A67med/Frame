use crate::platform::windows::video_viewport::{
    ensure_mpv_viewport, find_mpv_viewport, main_player_hwnd, position_mpv_viewport,
    set_mpv_viewport_visible, MpvGeometry, MPV_HDR_STAGE,
};
use std::collections::HashMap;
use std::ffi::CString;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use libmpv2::events::{Event, EventContext, PropertyData};
use libmpv2::mpv_node::MpvNode;
use libmpv2::{Format, Mpv, MpvInitializer};

pub(crate) fn mpv_argv_command(mpv: &Mpv, argv: &[&str]) -> Result<(), String> {
    let cstrings: Vec<CString> = argv
        .iter()
        .map(|s| CString::new(*s).map_err(|e| format!("cstring: {}", e)))
        .collect::<Result<Vec<_>, _>>()?;
    let mut ptrs: Vec<*const std::os::raw::c_char> = cstrings.iter().map(|c| c.as_ptr()).collect();
    ptrs.push(std::ptr::null());
    let rc = unsafe { libmpv2_sys::mpv_command(mpv.ctx.as_ptr(), ptrs.as_mut_ptr()) };
    if rc < 0 {
        return Err(format!("mpv_command rc={}", rc));
    }
    Ok(())
}
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct MpvProbe {
    pub available: bool,
    pub binary: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvStartArgs {
    pub url: String,
    pub start_at_sec: Option<f64>,
    pub subtitles: Option<Vec<MpvSub>>,
    pub anime4k: Option<bool>,
    pub hdr_to_sdr: Option<bool>,
    pub rtx_hdr: Option<bool>,
    pub rtx_vsr: Option<bool>,
    pub embed: Option<bool>,
    pub anime4k_shaders: Option<Vec<String>>,
    pub is_live: Option<bool>,
    pub full_download: Option<bool>,
    pub cache_dir: Option<String>,
    pub startup_profile: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub extra_options: Option<String>,
    pub renderer: Option<String>,
    pub force_yuv420p: Option<bool>,
    pub separate_display: Option<crate::monitors::MonitorInfo>,
    /// Fill the whole monitor (cover the taskbar) instead of the work area.
    pub separate_cover_taskbar: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MpvSub {
    pub url: String,
    pub lang: Option<String>,
}

pub struct MpvState {
    inner: Arc<Mutex<Option<MpvSession>>>,
    // Serialize start/stop while the session lock is released for a display switch.
    // Property reads still use only `inner`, so they remain responsive.
    #[cfg(windows)]
    lifecycle: Mutex<()>,
}

struct MpvSession {
    mpv: Arc<Mpv>,
    is_live: bool,
    embedded: bool,
    /// OS-level HDR state when the session started. Compared against the
    /// script-reported state at teardown: only an off->on flip waits.
    #[cfg(windows)]
    hdr_baseline_on: bool,
    /// Monitor this session's video is actually on, as a raw `HMONITOR` value
    /// (kept as `isize` so the session stays `Send`). Embedded -> "main"'s
    /// monitor; separate window -> the chosen monitor (or "main"'s when
    /// Automatic). The HDR flip and its restore key off this, not off "main",
    /// so a separate player on another display flips the right screen.
    #[cfg(windows)]
    hdr_monitor: Option<isize>,
}

impl MpvState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            #[cfg(windows)]
            lifecycle: Mutex::new(()),
        }
    }
}

const OBSERVED_PROPS: &[(&str, u64, PropertyKind)] = &[
    ("time-pos", 1, PropertyKind::Double),
    ("duration", 2, PropertyKind::Double),
    ("pause", 3, PropertyKind::Flag),
    ("eof-reached", 4, PropertyKind::Flag),
    ("track-list", 5, PropertyKind::Node),
    ("volume", 6, PropertyKind::Double),
    ("mute", 7, PropertyKind::Flag),
    ("chapter-list", 8, PropertyKind::Node),
    ("sub-delay", 9, PropertyKind::Double),
    ("audio-delay", 10, PropertyKind::Double),
    ("sub-text", 11, PropertyKind::String),
    ("sub-start", 12, PropertyKind::Double),
    ("af", 13, PropertyKind::String),
    ("dwidth", 14, PropertyKind::Int64),
    ("dheight", 15, PropertyKind::Int64),
    ("video-params/gamma", 16, PropertyKind::String),
    ("demuxer-cache-duration", 17, PropertyKind::Double),
    ("paused-for-cache", 18, PropertyKind::Flag),
    ("secondary-sub-text", 19, PropertyKind::String),
    ("path", 20, PropertyKind::String),
    ("audio-device-list", 21, PropertyKind::Node),
];

#[derive(Clone, Copy)]
enum PropertyKind {
    Double,
    Flag,
    Int64,
    String,
    Node,
}

impl PropertyKind {
    fn fmt(&self) -> Format {
        match self {
            PropertyKind::Double => Format::Double,
            PropertyKind::Flag => Format::Flag,
            PropertyKind::Int64 => Format::Int64,
            PropertyKind::String => Format::String,
            PropertyKind::Node => Format::Node,
        }
    }
}

#[tauri::command]
pub async fn mpv_probe(_app: AppHandle) -> MpvProbe {
    match Mpv::with_initializer(|init| {
        let _ = init.set_property("media-controls", "no");
        Ok(())
    }) {
        Ok(mpv) => {
            let version = mpv
                .get_property::<String>("mpv-version")
                .ok()
                .or_else(|| Some("libmpv (embedded)".to_string()));
            MpvProbe {
                available: true,
                binary: Some("embedded libmpv".into()),
                version,
                error: None,
            }
        }
        Err(e) => MpvProbe {
            available: false,
            binary: None,
            version: None,
            error: Some(format!("libmpv init failed: {}", e)),
        },
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioDevice {
    pub name: String,
    pub description: String,
}

fn read_audio_devices(mpv: &Mpv) -> Vec<AudioDevice> {
    let node = match mpv.get_property::<MpvNode>("audio-device-list") {
        Ok(n) => n,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    if let Some(arr) = node.array() {
        for item in arr {
            let mut name = String::new();
            let mut description = String::new();
            if let Some(map) = item.map() {
                for (k, v) in map {
                    match k.as_str() {
                        "name" => name = v.str().unwrap_or_default().to_string(),
                        "description" => description = v.str().unwrap_or_default().to_string(),
                        _ => {}
                    }
                }
            }
            if !name.is_empty() && name != "auto" {
                out.push(AudioDevice { name, description });
            }
        }
    }
    out
}

#[tauri::command]
pub async fn mpv_audio_devices(state: State<'_, MpvState>) -> Result<Vec<AudioDevice>, String> {
    let existing = {
        let g = state.inner.lock().await;
        g.as_ref().map(|s| s.mpv.clone())
    };
    if let Some(mpv) = existing {
        return Ok(read_audio_devices(&mpv));
    }
    let mpv = Mpv::with_initializer(|init| {
        let _ = init.set_property("media-controls", "no");
        Ok(())
    })
    .map_err(|e| format!("mpv init: {}", e))?;
    Ok(read_audio_devices(&mpv))
}

fn mpv_header_field(name: &str, value: &str) -> String {
    // mpv parses this option as a comma-separated string list. An unescaped
    // Accept-Language comma creates an invalid second HTTP header (HTTP 400).
    format!("{name}: {value}")
        .replace('\\', "\\\\")
        .replace(',', "\\,")
}

fn video_output(args: &MpvStartArgs) -> &'static str {
    match args.renderer.as_deref() {
        Some("gpu") => "gpu",
        _ => "gpu-next",
    }
}

fn apply_pre_init(
    init: &MpvInitializer,
    args: &MpvStartArgs,
    embed_hwnd: Option<&str>,
    separate_screen: Option<i32>,
    separate_screen_size: Option<(u32, u32)>,
) -> Result<(), String> {
    // Property sets here are best-effort. Some builds of mpv (e.g. Flatpak's
    // meson build without Lua) omit optional properties like `osc`. Treat
    // PROPERTY_NOT_FOUND as non-fatal so the player still initializes.
    let set = |k: &str, v: &str| {
        if let Err(e) = init.set_property(k, v) {
            eprintln!("[harbor::mpv] pre-init skip {}={}: {}", k, v, e);
        }
    };
    // Scripts and script options must be applied before mpv initializes; they
    // cannot be set afterwards. Parse them out of extra_options so the
    // post-init pass skips them.
    let (init_only_pairs, _rest) = args
        .extra_options
        .as_deref()
        .map(split_extra_option_pairs)
        .unwrap_or_default();
    let joined_init_only = join_init_only_pairs(&init_only_pairs);
    set("title", "Frame");
    set("audio-client-name", "Frame");
    set("terminal", "no");
    set("msg-level", "all=warn,vo=v,d3d11=v,gpu=v,win32=v");
    let is_live = args.is_live.unwrap_or(false);
    set("ytdl", if is_live { "yes" } else { "no" });
    let mut user_agent = "VLC/3.0.20 LibVLC/3.0.20".to_string();
    let mut header_fields: Vec<String> = Vec::new();
    if let Some(headers) = &args.headers {
        for (k, v) in headers {
            if k.eq_ignore_ascii_case("user-agent") {
                user_agent = v.clone();
            } else {
                header_fields.push(mpv_header_field(k, v));
            }
        }
    }
    set("user-agent", &user_agent);
    if !header_fields.is_empty() {
        set("http-header-fields", &header_fields.join(","));
    }
    let rtx = args.rtx_hdr.unwrap_or(false);
    let rtx_vsr = args.rtx_vsr.unwrap_or(false);
    // RTX Video HDR and RTX Video Super Resolution both need native D3D11
    // hardware frames for mpv's d3d11vpp filter.
    let rtx_video = rtx || rtx_vsr;
    set("hwdec", if rtx_video { "d3d11va" } else { "auto-safe" });
    set("force-window", "immediate");
    set("input-default-bindings", "no");
    set("input-media-keys", "no");
    set("input-cursor", "no");
    // `osc` is provided by mpv's optional on-screen-controller script. Some
    // libmpv builds, including the Flatpak build, do not ship that script, so
    // its option is unavailable. Frame supplies its own controls either way.
    let _ = set("osc", "no");
    set("osd-level", "0");
    set("cursor-autohide", "200");
    set("volume-max", "600");
    set("sub-codepage", "utf-8");
    let _ = init.set_property("background-color", "#000000");
    let _ = init.set_property("background", "color");
    let _ = init.set_property("media-controls", "no");

    if let Some(hwnd) = embed_hwnd {
        #[cfg(windows)]
        {
            let hwnd_i64: i64 = hwnd
                .parse()
                .map_err(|e| format!("parse wid {}: {}", hwnd, e))?;
            init.set_property("wid", hwnd_i64)
                .map_err(|e| format!("set wid={}: {}", hwnd_i64, e))?;
            set("vo", video_output(args));
            set("gpu-api", "d3d11");
            // Preserve synchronized flip-model presentation in both SDR and HDR.
            set("d3d11-flip", "yes");
            set("d3d11-sync-interval", "1");
        }
    } else if !args.embed.unwrap_or(false) {
        set("ontop", "yes");
        set("border", "no");
        // The separate-window player is created with force-window: immediate
        // while mpv_initialize runs, so its win32 monitor must be fixed here
        // pre-init or the VO window lands on the primary monitor. `screen` is
        // a 0-based EnumDisplayMonitors ordinal.
        #[cfg(windows)]
        if let Some(idx) = separate_screen {
            set("screen", idx.to_string().as_str());
            // Size the VO window to the monitor's exact physical pixels. mpv
            // applies the monitor's DPI factor to `geometry` by default (a
            // 3840x2160 monitor at 225% became a 3648x2052 window), so scaling
            // is turned off for the separate window and the requested WxH is
            // then honoured literally. keepaspect-window (default yes) would
            // also snap the window back to the video's aspect and leave a gap.
            if let Some((w, h)) = separate_screen_size {
                set("hidpi-window-scale", "no");
                set("keepaspect-window", "no");
                set("geometry", format!("{w}x{h}").as_str());
            }
        }
    }

    let opt = |k: &str, v: &str| {
        let _ = init.set_property(k, v);
    };
    if rtx {
        opt("gpu-api", "d3d11");
        opt("target-colorspace-hint", "yes");
        opt("target-peak", "10000");
    } else if args.hdr_to_sdr.unwrap_or(false) {
        opt("tone-mapping", "spline");
        opt("gamut-mapping-mode", "perceptual");
        opt("hdr-compute-peak", "yes");
        opt("hdr-contrast-recovery", "0.30");
        opt("hdr-peak-percentile", "99.995");
        opt("dither-depth", "auto");
        opt("target-trc", "bt.1886");
        opt("target-prim", "bt.709");
        opt("target-colorspace-hint", "yes");
        // VSR still needs the D3D11 backend even while tonemapping HDR to SDR.
        #[cfg(windows)]
        if rtx_vsr {
            opt("gpu-api", "d3d11");
        }
    } else {
        #[cfg(windows)]
        {
            opt("target-colorspace-hint", "yes");
            if rtx_vsr {
                opt("gpu-api", "d3d11");
            }
        }
    }

    if let Some(shaders) = &args.anime4k_shaders {
        let cleaned: Vec<String> = shaders
            .iter()
            .filter(|s| !s.is_empty())
            .map(|s| s.replace('\\', "/"))
            .collect();
        if !cleaned.is_empty() {
            let sep = ";";
            let joined = cleaned.join(sep);
            opt("glsl-shaders", &joined);
        }
    }

    if let Some(start) = args.start_at_sec {
        if start > 0.0 {
            set("start", &format!("{}", start));
        }
    }
    for (key, value) in &joined_init_only {
        set(key, value);
    }
    Ok(())
}

fn parse_extra_option_lines(raw: &str) -> Vec<(String, String)> {
    let mut options = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }
        let (key, value) = if let Some((k, v)) = line.split_once('=') {
            (k.trim(), v.trim())
        } else if let Some((k, v)) = line.split_once(char::is_whitespace) {
            (k.trim(), v.trim())
        } else {
            (line, "yes")
        };
        let key = key.trim_start_matches("--").trim();
        if key.is_empty() {
            continue;
        }
        options.push((key.to_string(), value.to_string()));
    }
    options
}

/// Extra-option keys that only take effect before mpv initializes. Scripts
/// and script options must be present when mpv_initialize runs; setting them
/// afterwards is rejected or silently ignored.
const EXTRA_INIT_ONLY_KEYS: &[&str] = &["scripts", "script-opts", "load-scripts", "load-script"];

fn is_init_only_key(key: &str) -> bool {
    EXTRA_INIT_ONLY_KEYS
        .iter()
        .any(|k| k.eq_ignore_ascii_case(key))
}

/// Splits parsed extra options into (init_only, rest), preserving the order
/// within each bucket. `load-script` entries are folded into the `scripts`
/// bucket so every script path is joined and applied together pre-init.
fn split_extra_option_pairs(raw: &str) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let mut init_only = Vec::new();
    let mut rest = Vec::new();
    for (key, value) in parse_extra_option_lines(raw) {
        if is_init_only_key(&key) {
            let key = key.to_ascii_lowercase();
            let key = if key == "load-script" {
                "scripts".to_string()
            } else {
                key
            };
            init_only.push((key, value));
        } else {
            rest.push((key, value));
        }
    }
    (init_only, rest)
}

/// Joins init-only pairs into single option values. `scripts` entries are
/// joined with ';' on Windows and ':' elsewhere (empty entries rejected),
/// `script-opts` with ',', and `load-scripts` keeps the last non-empty value.
fn join_init_only_pairs(pairs: &[(String, String)]) -> Vec<(String, String)> {
    let mut scripts: Vec<String> = Vec::new();
    let mut script_opts: Vec<String> = Vec::new();
    let mut load_scripts: Option<String> = None;
    for (key, value) in pairs {
        match key.as_str() {
            "scripts" => {
                if !value.is_empty() {
                    scripts.push(value.clone());
                }
            }
            "script-opts" => {
                if !value.is_empty() {
                    script_opts.push(value.clone());
                }
            }
            "load-scripts" => {
                if !value.is_empty() {
                    load_scripts = Some(value.clone());
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    if !scripts.is_empty() {
        let sep = ";";
        out.push(("scripts".to_string(), scripts.join(sep)));
    }
    if !script_opts.is_empty() {
        out.push(("script-opts".to_string(), script_opts.join(",")));
    }
    if let Some(v) = load_scripts {
        out.push(("load-scripts".to_string(), v));
    }
    out
}

fn apply_extra_mpv_options(mpv: &Mpv, raw: &str) {
    for (key, value) in parse_extra_option_lines(raw) {
        if is_init_only_key(&key) {
            eprintln!(
                "[harbor::mpv] extra option {}={} skipped (init-only)",
                key, value
            );
            continue;
        }
        match mpv.set_property(&key, value.as_str()) {
            Ok(()) => eprintln!("[harbor::mpv] extra option set {}={}", key, value),
            Err(e) => eprintln!(
                "[harbor::mpv] extra option {}={} rejected: {:?}",
                key, value, e
            ),
        }
    }
}

fn is_local_network_url(url: &str) -> bool {
    let rest = match url.split_once("://") {
        Some((_, r)) => r,
        None => return false,
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = match authority.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => h,
        _ => authority,
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.eq_ignore_ascii_case("localhost") || host == "::1" {
        return true;
    }
    if host.starts_with("127.") || host.starts_with("10.") || host.starts_with("192.168.") {
        return true;
    }
    match host.strip_prefix("172.").and_then(|r| r.split_once('.')) {
        Some((second, _)) => matches!(second.parse::<u8>(), Ok(n) if (16..=31).contains(&n)),
        None => false,
    }
}

fn network_timeout_for(url: &str) -> &'static str {
    if is_local_network_url(url) {
        "600"
    } else {
        "60"
    }
}

fn source_kind(url: &str) -> &'static str {
    if is_local_network_url(url) {
        "local-http"
    } else if url.starts_with("https://") {
        "https"
    } else if url.starts_with("http://") {
        "http"
    } else if url.starts_with("file://") || !url.contains("://") {
        "local-file"
    } else {
        "other"
    }
}

#[tauri::command]
pub async fn mpv_start(
    app: AppHandle,
    state: State<'_, MpvState>,
    args: MpvStartArgs,
) -> Result<(), String> {
    #[cfg(windows)]
    let _lifecycle = state.lifecycle.lock().await;
    let want_embed = args.embed.unwrap_or(false);
    // Resolve the monitor this session's video lands on before anything reads HDR
    // state. Embedded mpv is a child of "main"; a separate window goes to the
    // chosen display, or "main"'s when the setting is Automatic or the monitor is
    // gone. HDR must key off this monitor, not off "main", or a separate player on
    // another display flips the wrong screen.
    #[cfg(windows)]
    let target_monitor = if want_embed {
        app.get_webview_window("main")
            .and_then(|w| w.hwnd().ok())
            .and_then(|h| crate::monitors::resolve_for_hwnd(h.0 as isize))
    } else {
        crate::monitors::resolve_or_default(args.separate_display.as_ref()).or_else(|| {
            app.get_webview_window("main")
                .and_then(|w| w.hwnd().ok())
                .and_then(|h| crate::monitors::resolve_for_hwnd(h.0 as isize))
        })
    };
    let playback_cache = if args.is_live.unwrap_or(false) {
        None
    } else {
        let base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
        let dir = crate::features::playback::cache::cache_dir(&base, args.cache_dir.as_deref())?;
        crate::features::playback::cache::prepare_dir(&dir)?;
        Some(dir)
    };
    // OS-level HDR state before this transition begins. Compared at teardown
    // against the script-reported state: only off->on waits for restore.
    #[cfg(windows)]
    let hdr_baseline_on = target_monitor
        .map(|m| monitor_hdr_active(m.hmon))
        .unwrap_or(false);
    #[cfg(windows)]
    let hdr_monitor = target_monitor.map(|m| m.hmon.0 as isize);
    #[cfg(windows)]
    let separate_screen_for_init = if want_embed {
        None
    } else {
        target_monitor.map(|m| m.screen_index)
    };
    // Fill the whole monitor by default; the setting drops to the work area so
    // the taskbar stays visible on that display.
    #[cfg(windows)]
    let separate_cover_taskbar = args.separate_cover_taskbar.unwrap_or(true);
    #[cfg(windows)]
    let separate_screen_size_for_init = if want_embed {
        None
    } else {
        target_monitor.map(|m| {
            if separate_cover_taskbar {
                (m.width, m.height)
            } else {
                (m.work_width, m.work_height)
            }
        })
    };
    #[cfg(windows)]
    let separate_screen_pos_for_init = if want_embed {
        None
    } else {
        target_monitor.map(|m| {
            if separate_cover_taskbar {
                (m.x, m.y)
            } else {
                (m.work_x, m.work_y)
            }
        })
    };
    let mut g = state.inner.lock().await;
    let prev = g.take();
    // Windows releases the session lock across the SDR restore: a display mode
    // switch can take seconds, and every property poll would queue behind it.
    #[cfg(windows)]
    {
        drop(g);
    }
    if let Some(prev) = prev {
        #[cfg(windows)]
        {
            let was_off = !prev.hdr_baseline_on;
            let prev_monitor = prev.hdr_monitor;
            let _ = prev.mpv.command("quit", &[]);
            drop(prev);
            restore_display_sdr_if_flipped(&app, was_off, prev_monitor).await;
        }
    }
    #[cfg(windows)]
    let mut g = state.inner.lock().await;

    if let Some(dir) = &playback_cache {
        if args
            .cache_dir
            .as_deref()
            .is_some_and(|s| !s.trim().is_empty())
        {
            let _ = crate::temp_prune::sweep_mpv_cache(dir.clone());
        }
    }

    #[cfg(windows)]
    let embed_hwnd = if want_embed {
        Some(ensure_mpv_viewport(&app).await?)
    } else {
        None
    };
    eprintln!(
        "[harbor::mpv] start source_kind={} want_embed={} embed_hwnd={:?}",
        source_kind(&args.url),
        want_embed,
        embed_hwnd
    );
    let embed_hwnd_for_init = embed_hwnd.clone();
    let args_for_init = args.clone();
    let init_err: Arc<std::sync::Mutex<Option<String>>> = Arc::new(std::sync::Mutex::new(None));
    let init_err_cap = init_err.clone();

    let mpv = Mpv::with_initializer(move |init| {
        if let Err(e) = apply_pre_init(
            &init,
            &args_for_init,
            embed_hwnd_for_init.as_deref(),
            separate_screen_for_init,
            separate_screen_size_for_init,
        ) {
            eprintln!("[harbor::mpv] pre-init failed: {}", e);
            if let Ok(mut g) = init_err_cap.lock() {
                *g = Some(e);
            }
            return Err(libmpv2::Error::Raw(-1));
        }
        Ok(())
    })
    .map_err(|e| {
        let msg = if let Ok(g) = init_err.lock() {
            g.clone().unwrap_or_else(|| format!("mpv init: {}", e))
        } else {
            format!("mpv init: {}", e)
        };
        eprintln!("[harbor::mpv] init error: {}", msg);
        msg
    })?;

    if let Some(dir) = &playback_cache {
        let path = dir
            .to_str()
            .ok_or("Playback cache folder is not valid UTF-8")?;
        // The option was renamed in mpv 0.41. Support both installed versions.
        mpv.set_property("demuxer-cache-dir", path)
            .or_else(|_| mpv.set_property("cache-dir", path))
            .map_err(|e| format!("Cannot configure playback cache folder: {e}"))?;
    }

    unsafe {
        let level = std::ffi::CString::new("warn").unwrap();
        libmpv2_sys::mpv_request_log_messages(mpv.ctx.as_ptr(), level.as_ptr());
    }
    {
        use tauri::Manager;
        if let Ok(dir) = app.path().app_data_dir() {
            let _ = std::fs::create_dir_all(&dir);
            let logp = dir.join("harbor-mpv.log");
            let _ = mpv.set_property("log-file", logp.to_string_lossy().as_ref());
        }
    }
    if embed_hwnd.is_none() {
        if let Err(e) = mpv.set_property("vo", video_output(&args)) {
            eprintln!("[harbor::mpv] vo set FAILED: {:?}", e);
        }
    }
    if args.force_yuv420p.unwrap_or(false) {
        if let Err(e) = mpv.set_property("vf-append", "format=yuv420p") {
            eprintln!("[harbor::mpv] vf yuv420p rejected: {:?}", e);
        }
    }

    // Size the separate window by setting its OS window rect directly. mpv's own
    // `geometry` cannot fill a scaled monitor: it clamps the borderless window to
    // the monitor *work area* (a 3840x2160 monitor with a taskbar reports
    // `max content size: 3840x2052`) and re-applies `keepaspect-window`, so the
    // requested 3840x2160 came back as 3648x2052. SetWindowPos bypasses all of
    // that and pins the VO window to the monitor's true pixel bounds.
    #[cfg(windows)]
    if !want_embed {
        if let Some((w, h)) = separate_screen_size_for_init {
            let x = separate_screen_pos_for_init.map(|p| p.0).unwrap_or(0);
            let y = separate_screen_pos_for_init.map(|p| p.1).unwrap_or(0);
            match size_separate_mpv_window(x, y, w as i32, h as i32) {
                Some(()) => eprintln!(
                    "[harbor::mpv] separate window sized via SetWindowPos {}x{}+{}+{}",
                    w, h, x, y
                ),
                None => eprintln!(
                    "[harbor::mpv] separate window VO not found yet; relying on mpv geometry"
                ),
            }
        }
    }

    let is_live = args.is_live.unwrap_or(false);
    if is_live {
        let _ = mpv.set_property("cache", "yes");
        let _ = mpv.set_property("cache-secs", "30");
        let _ = mpv.set_property("cache-pause", "yes");
        let _ = mpv.set_property("cache-pause-initial", "no");
        let _ = mpv.set_property("demuxer-max-bytes", "64MiB");
        let _ = mpv.set_property("demuxer-max-back-bytes", "16MiB");
        let _ = mpv.set_property("demuxer-readahead-secs", "20");
        let _ = mpv.set_property("network-timeout", "60");
        let _ = mpv.set_property(
            "stream-lavf-o",
            "reconnect=1,reconnect_delay_max=5,reconnect_on_network_error=1",
        );
        let _ = mpv.set_property("demuxer-lavf-o", "http_seekable=0,http_persistent=0");
        let _ = mpv.set_property("stream-buffer-size", "16MiB");
    } else {
        let full_dl = args.full_download.unwrap_or(false);
        let high_bitrate = args.startup_profile.as_deref() == Some("high-bitrate");
        let _ = mpv.set_property("cache", "yes");
        let _ = mpv.set_property(
            "cache-secs",
            if full_dl {
                "100000"
            } else if high_bitrate {
                "45"
            } else {
                "30"
            },
        );
        let _ = mpv.set_property("cache-pause", "yes");
        let _ = mpv.set_property("cache-pause-initial", "no");
        let _ = mpv.set_property(
            "cache-pause-wait",
            if full_dl {
                "10"
            } else if high_bitrate {
                "2"
            } else {
                "1"
            },
        );
        let _ = mpv.set_property(
            "demuxer-max-bytes",
            if full_dl {
                "48GiB"
            } else if high_bitrate {
                "256MiB"
            } else {
                "128MiB"
            },
        );
        let _ = mpv.set_property(
            "demuxer-max-back-bytes",
            if full_dl {
                "48GiB"
            } else if high_bitrate {
                "64MiB"
            } else {
                "32MiB"
            },
        );
        let _ = mpv.set_property(
            "demuxer-readahead-secs",
            if full_dl {
                "100000"
            } else if high_bitrate {
                "45"
            } else {
                "30"
            },
        );
        let _ = mpv.set_property("cache-on-disk", "yes");
        let _ = mpv.set_property("network-timeout", network_timeout_for(&args.url));
        // No reconnect_streamed: on AES-128 HLS every segment ends in a normal
        // EOF that ffmpeg then retries from offset 0, gets an empty body, and
        // backs off 1/3/7s. Measured on a vixsrc stream: 7 segments and 55s of
        // backoff per 100s with the flag, 94 segments and 0s without it.
        let reconnect_opts = "reconnect=1,reconnect_on_network_error=1,reconnect_on_http_error=429,reconnect_delay_max=10,reconnect_delay_total_max=60";
        match mpv.set_property("stream-lavf-o", reconnect_opts) {
            Ok(()) => eprintln!("[harbor::mpv] stream-lavf-o set {}", reconnect_opts),
            Err(e) => eprintln!("[harbor::mpv] stream-lavf-o rejected: {:?}", e),
        }
        let _ = mpv.set_property(
            "stream-buffer-size",
            if high_bitrate { "32MiB" } else { "16MiB" },
        );
    }
    // mpv may auto-select an embedded subtitle as soon as loadfile runs. Keep
    // both subtitle slots empty until Frame applies the user's language choice.
    // Still discover sidecars beside local files so they are available in the
    // track picker even for libraries indexed before sidecars were persisted.
    let _ = mpv.set_property("sub-auto", "all");
    let _ = mpv.set_property("sid", "no");
    let _ = mpv.set_property("secondary-sid", "no");
    if want_embed {
        let _ = mpv.set_property("sub-visibility", "no");
        let _ = mpv.set_property("secondary-sub-visibility", "no");
    }

    if let Some(fonts) = crate::fonts::sub_fonts_dir(&app) {
        if let Some(s) = fonts.to_str() {
            let _ = mpv.set_property("sub-fonts-dir", s);
        }
    }
    let _ = mpv.set_property("sub-font-provider", "auto");
    let _ = mpv.set_property("sub-font", "sans-serif");
    let _ = mpv.set_property("sub-ass-shaper", "complex");
    let _ = mpv.set_property("embeddedfonts", "yes");

    if let Some(extra) = args.extra_options.as_deref() {
        apply_extra_mpv_options(&mpv, extra);
    }

    if is_live {
        for (k, v) in [
            ("scale", "bilinear"),
            ("dscale", "bilinear"),
            ("cscale", "bilinear"),
            ("dither", "no"),
            ("deband", "no"),
            ("correct-downscaling", "no"),
            ("linear-downscaling", "no"),
            ("sigmoid-upscaling", "no"),
            ("hdr-compute-peak", "no"),
            ("interpolation", "no"),
        ] {
            let _ = mpv.set_property(k, v);
        }
    }

    let mpv_arc = Arc::new(mpv);

    let event_ctx = EventContext::new(mpv_arc.ctx);
    for (name, id, kind) in OBSERVED_PROPS {
        if let Err(e) = event_ctx.observe_property(name, kind.fmt(), *id) {
            eprintln!("[mpv] observe {} failed: {}", name, e);
        }
    }
    spawn_event_loop(
        app.clone(),
        mpv_arc.clone(),
        event_ctx,
        want_embed,
        #[cfg(windows)]
        hdr_monitor,
    );

    eprintln!(
        "[harbor::mpv] loadfile source_kind={}",
        source_kind(&args.url)
    );
    mpv_argv_command(&*mpv_arc, &["loadfile", &args.url, "replace"]).map_err(|e| {
        eprintln!("[harbor::mpv] loadfile FAILED: {}", e);
        format!("loadfile: {}", e)
    })?;
    eprintln!("[harbor::mpv] loadfile OK");

    // `loadfile replace` clears tracks added to the previous playlist entry,
    // so explicit sidecars must be attached after the video is loaded.
    // This is required for sidecars whose filename differs from the video and
    // therefore cannot be discovered by mpv's `sub-auto` matching alone.
    if let Some(subs) = &args.subtitles {
        for subtitle in subs {
            let url = subtitle.url.replace('\\', "/");
            if let Err(error) = mpv_argv_command(&mpv_arc, &["sub-add", &url, "auto"]) {
                eprintln!("[harbor::mpv] sub-add failed for {}: {}", url, error);
            }
        }
    }
    attach_local_sidecars(&mpv_arc, &args.url);

    *g = Some(MpvSession {
        mpv: mpv_arc,
        is_live,
        #[cfg(windows)]
        embedded: embed_hwnd.is_some(),
        #[cfg(windows)]
        hdr_baseline_on,
        #[cfg(windows)]
        hdr_monitor,
    });
    drop(g);

    Ok(())
}

#[cfg(windows)]
fn reassert_hdr_colorspace(mpv: &Arc<Mpv>) {
    let _ = mpv.set_property("target-peak", "10000");
    std::thread::sleep(Duration::from_millis(60));
    let _ = mpv.set_property("target-peak", "auto");
}

/// Confident HDR-to-SDR restore after mpv quit. The user script's own
/// shutdown toggle (hdr-mode.lua's `toggle-hdr-display off`) runs while the
/// vo window is already being destroyed and can be cut off before the display
/// flip lands, so Frame re-applies the flip itself once mpv is gone. Only
/// acts when this session flipped HDR off->on (baseline was SDR); a session
/// on an always-HDR display keeps that mode untouched.
///
/// The display is the one Frame's own window sits on, which matches the
/// embedded player (mpv is a child of "main"). The separate-window player is
/// opened on the same display (via the `screen` option), so the same monitor
/// check works for both modes.
#[cfg(windows)]
async fn restore_display_sdr_if_flipped(
    _app: &AppHandle,
    was_off: bool,
    hdr_monitor: Option<isize>,
) {
    if !was_off {
        eprintln!("[harbor::mpv] skip display restore (baseline HDR was on)");
        return;
    }
    tokio::time::sleep(Duration::from_millis(150)).await;
    let Some(hmon_raw) = hdr_monitor else {
        return;
    };
    // DisplayConfig drives a display mode switch that can block for seconds;
    // it never runs on the async runtime's worker threads.
    let restored = tokio::task::spawn_blocking(move || {
        let hmon = windows::Win32::Graphics::Gdi::HMONITOR(hmon_raw as *mut _);
        if !monitor_hdr_active(hmon) {
            return None;
        }
        Some(set_monitor_advanced_color(hmon, false))
    })
    .await
    .unwrap_or(None);
    match restored {
        None => eprintln!("[harbor::mpv] display already SDR after quit"),
        Some(true) => eprintln!("[harbor::mpv] display restored to SDR via DisplayConfig"),
        Some(false) => eprintln!("[harbor::mpv] DisplayConfig SDR restore failed"),
    }
}

const MPV_EVENT_MAX_CONSECUTIVE_ERRORS: u32 = 12;

#[derive(Default)]
struct EventErrorBackoff {
    consecutive: u32,
}

impl EventErrorBackoff {
    fn reset(&mut self) {
        self.consecutive = 0;
    }

    fn next_delay(&mut self) -> Option<Duration> {
        self.consecutive = self.consecutive.saturating_add(1);
        if self.consecutive >= MPV_EVENT_MAX_CONSECUTIVE_ERRORS {
            return None;
        }
        let shift = self.consecutive.saturating_sub(1).min(5);
        Some(Duration::from_millis((40_u64 << shift).min(1_000)))
    }
}

fn record_event_poll_success(backoff: &mut EventErrorBackoff) {
    backoff.reset();
}

fn spawn_event_loop(
    app: AppHandle,
    mpv_keepalive: Arc<Mpv>,
    mut ctx: EventContext,
    embedded: bool,
    #[cfg(windows)] hdr_monitor: Option<isize>,
) {
    std::thread::spawn(move || {
        let mut last_timepos: Option<std::time::Instant> = None;
        #[cfg(windows)]
        let reassert_gen = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let mut error_backoff = EventErrorBackoff::default();
        #[cfg(windows)]
        let mut last_hdr_status: Option<String> = None;
        loop {
            // display-info publishes user-data/display-info/hdr-status only
            // after the vo window exists, so observing it at init misses the
            // value; poll it and surface changes so the frontend can react to
            // the script's display flips.
            #[cfg(windows)]
            {
                let status = mpv_keepalive
                    .get_property::<String>("user-data/display-info/hdr-status")
                    .ok();
                if status != last_hdr_status {
                    last_hdr_status = status.clone();
                    if let Some(s) = &status {
                        let _ = app.emit("hdr-stage://display-status", s.as_str());
                    }
                }
            }
            let res = ctx.wait_event(0.5);
            match res {
                Some(Ok(event)) => {
                    record_event_poll_success(&mut error_backoff);
                    let mut shutdown = false;
                    if matches!(event, Event::Shutdown) {
                        shutdown = true;
                    }
                    if let Event::EndFile(reason) = &event {
                        eprintln!("[harbor::mpv] end-file reason={:?}", reason);
                    }
                    if let Event::PropertyChange { name, .. } = &event {
                        if *name == "time-pos" {
                            let now = std::time::Instant::now();
                            if let Some(prev) = last_timepos {
                                if now.duration_since(prev).as_millis() < 200 {
                                    continue;
                                }
                            }
                            last_timepos = Some(now);
                        }
                    }
                    #[cfg(windows)]
                    if embedded {
                        if let Event::PropertyChange { name, .. } = &event {
                            if *name == "video-params/gamma" {
                                let gen = reassert_gen
                                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                                    + 1;
                                let gen_arc = reassert_gen.clone();
                                let mpv2 = mpv_keepalive.clone();
                                std::thread::spawn(move || {
                                    std::thread::sleep(Duration::from_millis(250));
                                    if gen_arc.load(std::sync::atomic::Ordering::Relaxed) != gen {
                                        return;
                                    }
                                    let gamma = mpv2
                                        .get_property::<String>("video-params/gamma")
                                        .unwrap_or_default();
                                    if gamma != "pq" && gamma != "hlg" {
                                        return;
                                    }
                                    let hdr = hdr_monitor
                                        .map(|raw| {
                                            monitor_hdr_active(
                                                windows::Win32::Graphics::Gdi::HMONITOR(
                                                    raw as *mut _,
                                                ),
                                            )
                                        })
                                        .unwrap_or(false);
                                    if hdr {
                                        reassert_hdr_colorspace(&mpv2);
                                    }
                                });
                            }
                        }
                    }
                    if let Event::PropertyChange { name, change, .. } = &event {
                        if *name == "sub-text" && crate::captions::captions_is_open(&app) {
                            let text = match change {
                                PropertyData::Str(s) => s.to_string(),
                                PropertyData::OsdStr(s) => s.to_string(),
                                _ => String::new(),
                            };
                            let _ = app.emit_to("harbor-captions", "captions://text", text);
                        }
                    }
                    let payload = event_to_payload(event);
                    if let Some(p) = payload {
                        let _ = app.emit("mpv://event", p);
                    }
                    if shutdown {
                        break;
                    }
                }
                Some(Err(e)) => {
                    let delay = error_backoff.next_delay();
                    if error_backoff.consecutive == 1 || error_backoff.consecutive.is_power_of_two()
                    {
                        eprintln!(
                            "[mpv] event error (consecutive={}): {}",
                            error_backoff.consecutive, e
                        );
                    }
                    if matches!(e, libmpv2::Error::Raw(-13 | -16)) {
                        let _ = app.emit(
                            "mpv://event",
                            json!({ "event": "end-file", "reason": "error" }),
                        );
                    }
                    match delay {
                        Some(delay) => std::thread::sleep(delay),
                        None => {
                            let _ = app.emit(
                                "mpv://event",
                                json!({
                                    "event": "player-failure",
                                    "reason": "persistent-event-errors",
                                }),
                            );
                            break;
                        }
                    }
                }
                None => record_event_poll_success(&mut error_backoff),
            }
        }
        drop(mpv_keepalive);
    });
}

fn event_to_payload(event: Event) -> Option<Value> {
    match event {
        Event::PropertyChange { name, change, .. } => {
            let data = match change {
                PropertyData::Str(s) => Value::String(s.to_string()),
                PropertyData::OsdStr(s) => Value::String(s.to_string()),
                PropertyData::Flag(b) => Value::Bool(b),
                PropertyData::Int64(i) => json!(i),
                PropertyData::Double(f) => json!(f),
                PropertyData::Node(n) => mpv_node_to_json(n),
            };
            Some(json!({ "event": "property-change", "name": name, "data": data }))
        }
        Event::EndFile(reason) => {
            let reason = match reason {
                0 => "eof",
                2 => "stop",
                3 => "quit",
                4 => "error",
                5 => "redirect",
                _ => "other",
            };
            Some(json!({ "event": "end-file", "reason": reason }))
        }
        Event::FileLoaded => Some(json!({ "event": "file-loaded" })),
        Event::PlaybackRestart => Some(json!({ "event": "playback-restart" })),
        Event::Seek => Some(json!({ "event": "seek" })),
        Event::Shutdown => Some(json!({ "event": "shutdown" })),
        Event::LogMessage {
            prefix,
            level,
            text,
            ..
        } => Some(json!({ "event": "log", "prefix": prefix, "level": level, "text": text })),
        _ => None,
    }
}

fn mpv_node_to_json(node: MpvNode) -> Value {
    match node {
        MpvNode::None => Value::Null,
        MpvNode::String(s) => Value::String(s),
        MpvNode::Flag(b) => Value::Bool(b),
        MpvNode::Int64(i) => json!(i),
        MpvNode::Double(f) => json!(f),
        MpvNode::ArrayIter(it) => Value::Array(it.map(mpv_node_to_json).collect()),
        MpvNode::MapIter(it) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in it {
                obj.insert(k, mpv_node_to_json(v));
            }
            Value::Object(obj)
        }
    }
}

#[tauri::command]
pub async fn mpv_command(state: State<'_, MpvState>, cmd: Vec<Value>) -> Result<(), String> {
    let (mpv, is_live) = {
        let g = state.inner.lock().await;
        let s = g.as_ref().ok_or_else(|| "mpv not started".to_string())?;
        (s.mpv.clone(), s.is_live)
    };
    if cmd.is_empty() {
        return Err("empty command".into());
    }
    let head = cmd[0]
        .as_str()
        .ok_or_else(|| "first arg must be string".to_string())?;
    if !MPV_ALLOWED_COMMANDS.contains(&head) {
        return Err(format!("mpv command not allowed: {}", head));
    }
    let tail: Vec<String> = cmd[1..].iter().map(value_to_arg).collect();
    if head == "loadfile" && !is_live {
        if let Some(url) = tail.first() {
            let _ = mpv.set_property("network-timeout", network_timeout_for(url));
        }
    }
    let mut argv: Vec<&str> = Vec::with_capacity(tail.len() + 1);
    argv.push(head);
    for s in &tail {
        argv.push(s.as_str());
    }
    mpv_argv_command(&mpv, &argv)?;
    if head == "loadfile" {
        if let Some(url) = tail.first() {
            attach_local_sidecars(&mpv, url);
        }
    }
    Ok(())
}

fn attach_local_sidecars(mpv: &Mpv, url: &str) {
    if url.contains("://") {
        return;
    }
    for subtitle in crate::features::library::scan::adjacent_subtitles(std::path::Path::new(url)) {
        let normalized = subtitle.replace('\\', "/");
        if let Err(error) = mpv_argv_command(mpv, &["sub-add", &normalized, "auto"]) {
            eprintln!(
                "[harbor::mpv] adjacent sub-add failed for {}: {}",
                normalized, error
            );
        }
    }
}

const MPV_ALLOWED_COMMANDS: &[&str] = &[
    "af",
    "vf",
    "seek",
    "stop",
    "frame-step",
    "frame-back-step",
    "loadfile",
    "ao-reload",
];

fn mpv_property_blocked(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    const BLOCKED: &[&str] = &[
        "script",
        "input-",
        "load-scripts",
        "ytdl-raw",
        "screenshot-directory",
        "screenshot-template",
        "sub-add",
    ];
    BLOCKED.iter().any(|b| n.starts_with(b))
}

fn value_to_arg(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => {
            if *b {
                "yes".into()
            } else {
                "no".into()
            }
        }
        Value::Number(n) => n.to_string(),
        Value::Null => String::new(),
        _ => v.to_string(),
    }
}

#[tauri::command]
pub async fn mpv_set_property(
    state: State<'_, MpvState>,
    name: String,
    value: Value,
) -> Result<(), String> {
    let mpv = {
        let g = state.inner.lock().await;
        g.as_ref()
            .map(|s| s.mpv.clone())
            .ok_or_else(|| "mpv not started".to_string())?
    };
    if mpv_property_blocked(&name) {
        return Err(format!("mpv property not allowed: {}", name));
    }
    let str_val = value_to_arg(&value);
    mpv.set_property(&name, str_val.as_str())
        .map_err(|e| format!("set {}: {}", name, e))
}

#[tauri::command]
pub async fn mpv_get_property(state: State<'_, MpvState>, name: String) -> Result<Value, String> {
    let mpv = {
        let g = state.inner.lock().await;
        g.as_ref()
            .map(|s| s.mpv.clone())
            .ok_or_else(|| "mpv not started".to_string())?
    };
    let s = mpv
        .get_property::<String>(&name)
        .map_err(|e| format!("get {}: {}", name, e))?;
    Ok(match s.parse::<f64>() {
        Ok(n) if n.is_finite() => serde_json::json!(n),
        _ => Value::String(s),
    })
}

#[tauri::command]
pub async fn mpv_set_geometry(
    app: AppHandle,
    _state: State<'_, MpvState>,
    geom: MpvGeometry,
) -> Result<(), String> {
    // The detached window owns the live surface and resizes it through its own
    // fit command. Late geometry updates from Frame must not move that surface.
    if app
        .state::<crate::pip_window::PipWindowState>()
        .active
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Ok(());
    }
    #[cfg(windows)]
    {
        let embedded = {
            let g = _state.inner.lock().await;
            g.as_ref().map(|s| s.embedded).unwrap_or(false)
        };
        if embedded {
            return position_mpv_viewport(&app, geom);
        }
    }

    // Separate window: mpv owns its own placement. The `geom` here is the embed
    // rect measured inside Frame's layout, which must never be pushed onto the
    // standalone VO window (it sized it to a fraction of the chosen monitor).
    // The window is fixed on its display via the pre-init `screen` option instead.
    {
        let separate = {
            let g = _state.inner.lock().await;
            g.as_ref().map(|s| !s.embedded).unwrap_or(false)
        };
        if separate {
            return Ok(());
        }
    }

    {
        let mpv = {
            let g = _state.inner.lock().await;
            g.as_ref()
                .map(|s| s.mpv.clone())
                .ok_or_else(|| "mpv not started".to_string())?
        };
        let geo = format!(
            "{}x{}+{}+{}",
            geom.css_width as i32,
            geom.css_height as i32,
            geom.css_left as i32,
            geom.css_top as i32
        );
        mpv.set_property("geometry", geo.as_str())
            .map_err(|e| format!("geometry: {}", e))
    }
}

#[tauri::command]
pub fn mpv_export_log(app: AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let src = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("harbor-mpv.log");
    if !src.exists() {
        return Err("No player log yet. Play something first, then export.".into());
    }
    let dl = app.path().download_dir().map_err(|e| e.to_string())?;
    let dst = dl.join("harbor-mpv-log.txt");
    std::fs::copy(&src, &dst).map_err(|e| format!("copy: {}", e))?;
    Ok(dst.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn mpv_force_below(_app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        if MPV_HDR_STAGE.load(std::sync::atomic::Ordering::Relaxed)
            && _app
                .get_webview_window(crate::hdr_overlay::HDR_OVERLAY_LABEL)
                .is_some()
        {
            return Ok(());
        }
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        if let Some(viewport) = find_mpv_viewport(main_player_hwnd(&_app)?) {
            unsafe {
                SetWindowPos(
                    viewport,
                    Some(HWND_BOTTOM),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
                )
                .map_err(|e| format!("lower native video viewport: {e}"))?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mpv_set_hdr_stage(_app: AppHandle, active: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        MPV_HDR_STAGE.store(active, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn display_hdr_active(_app: AppHandle) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let window = match _app.get_webview_window("main") {
            Some(w) => w,
            None => return Ok(false),
        };
        let hwnd = match window.hwnd() {
            Ok(h) => h,
            Err(_) => return Ok(false),
        };
        return Ok(crate::monitors::resolve_for_hwnd(hwnd.0 as isize)
            .map(|m| monitor_hdr_active(m.hmon))
            .unwrap_or(false));
    }
}

/// Find mpv's top-level VO window (class `mpv`, owned by this process) and set
/// its rect to the given pixel bounds. Returns None when the window is not up
/// yet, so the caller can fall back to mpv's own geometry.
#[cfg(windows)]
fn size_separate_mpv_window(x: i32, y: i32, w: i32, h: i32) -> Option<()> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowThreadProcessId, SetWindowPos, HWND_TOP,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER,
    };

    let own_pid = std::process::id();

    struct State {
        own_pid: u32,
        found: Option<isize>,
    }
    let mut state = State {
        own_pid,
        found: None,
    };
    let state_ptr = &mut state as *mut State;

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let s = &mut *(lparam.0 as *mut State);
        if s.found.is_some() {
            return BOOL(0);
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid != s.own_pid {
            return BOOL(1);
        }
        let mut class_buf = [0u16; 256];
        let class_len = GetClassNameW(hwnd, &mut class_buf);
        let class_name = String::from_utf16_lossy(&class_buf[..class_len as usize]);
        if class_name == "mpv" || class_name.starts_with("mpv ") {
            s.found = Some(hwnd.0 as isize);
            return BOOL(0);
        }
        BOOL(1)
    }

    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(state_ptr as isize));
    }
    let target = HWND(state.found? as *mut _);
    unsafe {
        SetWindowPos(
            target,
            Some(HWND_TOP),
            x,
            y,
            w,
            h,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED,
        )
        .ok()
        .map(|_| ())
    }
}

#[cfg(windows)]
fn monitor_hdr_active(hmon: windows::Win32::Graphics::Gdi::HMONITOR) -> bool {
    use windows::core::Interface;
    use windows::Win32::Graphics::Dxgi::Common::DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput6, DXGI_ERROR_NOT_FOUND,
    };
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFOEXW};

    // Fallback rect is the monitor's own desktop rect, not a window rect: GDI and
    // DXGI HMONITOR handles can differ on multi-GPU, so when the handles do not
    // compare equal we test the monitor's centre against each output's desktop
    // rectangle instead.
    let mut mi = MONITORINFOEXW::default();
    mi.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    let have_rect =
        hmon.0 as isize != 0 && unsafe { GetMonitorInfoW(hmon, &mut mi.monitorInfo) }.as_bool();
    let mon_rect = mi.monitorInfo.rcMonitor;

    let factory: IDXGIFactory1 = match unsafe { CreateDXGIFactory1() } {
        Ok(f) => f,
        Err(_) => return false,
    };

    let mut adapter_idx = 0u32;
    loop {
        let adapter = match unsafe { factory.EnumAdapters1(adapter_idx) } {
            Ok(a) => a,
            Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
            Err(_) => break,
        };
        adapter_idx += 1;

        let mut output_idx = 0u32;
        loop {
            let output = match unsafe { adapter.EnumOutputs(output_idx) } {
                Ok(o) => o,
                Err(_) => break,
            };
            output_idx += 1;

            let output6: IDXGIOutput6 = match output.cast() {
                Ok(o) => o,
                Err(_) => continue,
            };
            let desc = match unsafe { output6.GetDesc1() } {
                Ok(d) => d,
                Err(_) => continue,
            };

            let monitor_matches =
                hmon.0 as isize != 0 && desc.Monitor.0 as isize == hmon.0 as isize;
            let rect_matches = have_rect && {
                let d = desc.DesktopCoordinates;
                let cx = (mon_rect.left + mon_rect.right) / 2;
                let cy = (mon_rect.top + mon_rect.bottom) / 2;
                cx >= d.left && cx < d.right && cy >= d.top && cy < d.bottom
            };
            if monitor_matches || rect_matches {
                return desc.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
            }
        }
    }
    false
}

/// Flips the display that `hwnd` sits on into or out of advanced color (HDR)
/// mode via the DisplayConfig set-advanced-color state packet. Same mechanism
/// Windows Settings and display-info.dll use; Frame calls it as an
/// authoritative restore after mpv teardown.
#[cfg(windows)]
fn set_monitor_advanced_color(hmon: windows::Win32::Graphics::Gdi::HMONITOR, enable: bool) -> bool {
    use windows::Win32::Devices::Display::{
        DisplayConfigGetDeviceInfo, DisplayConfigSetDeviceInfo, GetDisplayConfigBufferSizes,
        QueryDisplayConfig, DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
        DISPLAYCONFIG_DEVICE_INFO_SET_ADVANCED_COLOR_STATE, DISPLAYCONFIG_MODE_INFO,
        DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SET_ADVANCED_COLOR_STATE,
        DISPLAYCONFIG_SOURCE_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
    };
    use windows::Win32::Foundation::WIN32_ERROR;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFOEXW};

    fn wide_to_string(raw: &[u16]) -> String {
        String::from_utf16_lossy(
            &raw.iter()
                .take_while(|&&c| c != 0)
                .copied()
                .collect::<Vec<u16>>(),
        )
    }

    if hmon.0 as isize == 0 {
        return false;
    }
    let mut mi = MONITORINFOEXW::default();
    mi.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if unsafe { GetMonitorInfoW(hmon, &mut mi.monitorInfo) }.as_bool() == false {
        return false;
    }
    let device = wide_to_string(&mi.szDevice);
    if device.is_empty() {
        return false;
    }

    unsafe {
        let mut path_count = 0u32;
        let mut mode_count = 0u32;
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
            != WIN32_ERROR(0)
            || path_count == 0
            || path_count > 64
        {
            return false;
        }
        let mut paths: Vec<DISPLAYCONFIG_PATH_INFO> = Vec::new();
        paths.resize_with(path_count as usize, DISPLAYCONFIG_PATH_INFO::default);
        let mut modes: Vec<DISPLAYCONFIG_MODE_INFO> = Vec::new();
        modes.resize_with(mode_count.max(1) as usize, DISPLAYCONFIG_MODE_INFO::default);
        if QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            None,
        ) != WIN32_ERROR(0)
        {
            return false;
        }
        for path in paths.iter().take(path_count as usize) {
            let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
            source.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            source.header.size = std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
            source.header.adapterId = path.sourceInfo.adapterId;
            source.header.id = path.sourceInfo.id;
            if DisplayConfigGetDeviceInfo(&mut source.header) != 0 {
                continue;
            }
            if wide_to_string(&source.viewGdiDeviceName) != device {
                continue;
            }
            // Bit 0 of the state union is advancedColorEnabled (1 = HDR).
            let mut set = DISPLAYCONFIG_SET_ADVANCED_COLOR_STATE::default();
            set.header.r#type = DISPLAYCONFIG_DEVICE_INFO_SET_ADVANCED_COLOR_STATE;
            set.header.size = std::mem::size_of::<DISPLAYCONFIG_SET_ADVANCED_COLOR_STATE>() as u32;
            set.header.adapterId = path.targetInfo.adapterId;
            set.header.id = path.targetInfo.id;
            set.Anonymous.value = if enable { 1 } else { 0 };
            return DisplayConfigSetDeviceInfo(&set.header) == 0;
        }
    }
    false
}

#[tauri::command]
pub async fn mpv_save_screenshot(
    state: State<'_, MpvState>,
    path: String,
) -> Result<String, String> {
    let mpv = {
        let g = state.inner.lock().await;
        g.as_ref()
            .map(|s| s.mpv.clone())
            .ok_or_else(|| "mpv not started".to_string())?
    };
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = mpv.set_property("screenshot-format", "png");
    let _ = mpv.set_property("screenshot-png-compression", "3");
    let _ = mpv.set_property("screenshot-sw", "yes");
    mpv_argv_command(&mpv, &["screenshot-to-file", path.as_str(), "video"])
        .map_err(|e| format!("screenshot-to-file: {}", e))?;
    let target = std::path::Path::new(&path).to_path_buf();
    let mut waited = 0u64;
    while waited < 3000 {
        if target.exists() {
            if let Ok(meta) = std::fs::metadata(&target) {
                if meta.len() > 0 {
                    return Ok(path);
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
        waited += 40;
    }
    Err("screenshot did not finish writing".to_string())
}

struct GifSession {
    dir: PathBuf,
    stop: Arc<std::sync::atomic::AtomicBool>,
    handle: tokio::task::JoinHandle<()>,
    captured_ms: Arc<std::sync::atomic::AtomicU64>,
}

static GIF_SESSION: std::sync::OnceLock<std::sync::Mutex<Option<GifSession>>> =
    std::sync::OnceLock::new();

fn gif_slot() -> &'static std::sync::Mutex<Option<GifSession>> {
    GIF_SESSION.get_or_init(|| std::sync::Mutex::new(None))
}

const GIF_FRAME_INTERVAL_MS: u64 = 50;
const GIF_MAX_FRAMES: u32 = 600;
const GIF_FALLBACK_FPS: f64 = 12.0;

#[derive(Serialize)]
pub struct GifResult {
    path: String,
    frames: u32,
}

#[tauri::command]
pub async fn mpv_gif_start(state: State<'_, MpvState>) -> Result<(), String> {
    let mpv = {
        let g = state.inner.lock().await;
        g.as_ref()
            .map(|s| s.mpv.clone())
            .ok_or_else(|| "mpv not started".to_string())?
    };
    {
        let g = gif_slot().lock().map_err(|e| format!("gif lock: {}", e))?;
        if g.is_some() {
            return Err("already recording".into());
        }
    }
    let dir = std::env::temp_dir().join(format!("harbor-gif-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create temp dir: {}", e))?;
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_task = stop.clone();
    let dir_task = dir.clone();
    let captured_ms = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let captured_task = captured_ms.clone();
    let handle = tokio::spawn(async move {
        let started = std::time::Instant::now();
        let _ = mpv.set_property("screenshot-format", "jpg");
        let _ = mpv.set_property("screenshot-jpeg-quality", "92");
        let _ = mpv.set_property("screenshot-sw", "yes");
        let mut frame: u32 = 0;
        while !stop_task.load(std::sync::atomic::Ordering::Relaxed) && frame < GIF_MAX_FRAMES {
            let path = dir_task.join(format!("f{:05}.jpg", frame));
            let p = path.to_string_lossy().to_string();
            if mpv_argv_command(&mpv, &["screenshot-to-file", p.as_str(), "video"]).is_ok() {
                frame += 1;
                captured_task.store(
                    started.elapsed().as_millis() as u64,
                    std::sync::atomic::Ordering::Relaxed,
                );
            }
            tokio::time::sleep(Duration::from_millis(GIF_FRAME_INTERVAL_MS)).await;
        }
    });
    *gif_slot().lock().map_err(|e| format!("gif lock: {}", e))? = Some(GifSession {
        dir,
        stop,
        handle,
        captured_ms,
    });
    Ok(())
}

#[tauri::command]
pub async fn mpv_gif_abort() -> Result<(), String> {
    let session = {
        gif_slot()
            .lock()
            .map_err(|e| format!("gif lock: {}", e))?
            .take()
    };
    if let Some(session) = session {
        session
            .stop
            .store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = session.handle.await;
        let _ = std::fs::remove_dir_all(&session.dir);
    }
    Ok(())
}

#[tauri::command]
pub async fn mpv_gif_stop(out_path: String) -> Result<GifResult, String> {
    let session = {
        gif_slot()
            .lock()
            .map_err(|e| format!("gif lock: {}", e))?
            .take()
    };
    let Some(session) = session else {
        return Err("not recording".into());
    };
    session
        .stop
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = session.handle.await;
    tokio::time::sleep(Duration::from_millis(300)).await;

    let mut frames: Vec<PathBuf> = std::fs::read_dir(&session.dir)
        .map_err(|e| format!("read temp dir: {}", e))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("jpg"))
        .collect();
    frames.sort();
    if frames.is_empty() {
        let _ = std::fs::remove_dir_all(&session.dir);
        return Err("no frames captured".into());
    }

    let window_ms = session
        .captured_ms
        .load(std::sync::atomic::Ordering::Relaxed);
    let n = frames.len() as f64;
    let fps = if n >= 2.0 && window_ms >= 200 {
        (n / (window_ms as f64 / 1000.0)).clamp(2.0, 30.0)
    } else {
        GIF_FALLBACK_FPS
    };
    let dur = 1.0_f64 / fps;

    let ffmpeg = crate::transcode::locate_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;

    let list_path = session.dir.join("frames.txt");
    let mut list = String::new();
    for f in &frames {
        let name = f.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        list.push_str(&format!("file '{}'\nduration {:.4}\n", name, dur));
    }
    if let Some(last) = frames.last() {
        let name = last
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        list.push_str(&format!("file '{}'\n", name));
    }
    std::fs::write(&list_path, list).map_err(|e| format!("write list: {}", e))?;

    if let Some(parent) = std::path::Path::new(&out_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let palette = session.dir.join("palette.png");
    let list_str = list_path.to_string_lossy().to_string();
    let palette_str = palette.to_string_lossy().to_string();
    let vf_pal = format!(
        "fps={:.3},scale=640:-2:flags=lanczos,palettegen=stats_mode=diff",
        fps
    );
    let lavfi = format!(
        "fps={:.3},scale=640:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3",
        fps
    );

    let pass1 = run_gif_ffmpeg(
        &ffmpeg,
        &[
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_str,
            "-vf",
            &vf_pal,
            &palette_str,
        ],
    )
    .await;
    if let Err(e) = pass1 {
        let _ = std::fs::remove_dir_all(&session.dir);
        return Err(format!("palettegen: {}", e));
    }
    let pass2 = run_gif_ffmpeg(
        &ffmpeg,
        &[
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_str,
            "-i",
            &palette_str,
            "-lavfi",
            &lavfi,
            out_path.as_str(),
        ],
    )
    .await;
    let _ = std::fs::remove_dir_all(&session.dir);
    if let Err(e) = pass2 {
        return Err(format!("paletteuse: {}", e));
    }
    Ok(GifResult {
        path: out_path,
        frames: frames.len() as u32,
    })
}

async fn run_gif_ffmpeg(ffmpeg: &std::path::Path, args: &[&str]) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new(ffmpeg);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let status = cmd
        .status()
        .await
        .map_err(|e| format!("spawn ffmpeg: {}", e))?;
    if !status.success() {
        return Err(format!("ffmpeg exit {:?}", status.code()));
    }
    Ok(())
}

#[derive(Serialize)]
pub struct ClipResult {
    path: String,
    duration: f64,
}

#[tauri::command]
pub async fn mpv_clip_save(
    state: State<'_, MpvState>,
    with_subs: bool,
    before_sec: f64,
    out_path: String,
) -> Result<ClipResult, String> {
    let mpv = {
        let g = state.inner.lock().await;
        g.as_ref()
            .map(|s| s.mpv.clone())
            .ok_or_else(|| "mpv not started".to_string())?
    };
    let src = mpv
        .get_property::<String>("path")
        .map_err(|e| format!("no source path: {}", e))?;
    let pos: f64 = mpv
        .get_property::<String>("time-pos")
        .map_err(|e| format!("no position: {}", e))?
        .trim()
        .parse()
        .map_err(|_| "bad position".to_string())?;
    let start = (pos - before_sec).max(0.0);
    let dur = pos - start;
    if dur < 0.5 {
        return Err("not enough playback to clip yet".into());
    }

    let sub_external = if with_subs {
        mpv.get_property::<String>("current-tracks/sub/external-filename")
            .ok()
            .filter(|s| !s.trim().is_empty())
    } else {
        None
    };
    let sub_id = if with_subs {
        mpv.get_property::<String>("sid")
            .ok()
            .filter(|s| s.trim() != "no" && !s.trim().is_empty())
    } else {
        None
    };
    let sub_filter_sdh = with_subs
        && mpv
            .get_property::<String>("sub-filter-sdh")
            .map(|v| v.trim() == "yes")
            .unwrap_or(false);

    let mpv_bin = crate::thumbs::locate_mpv().ok_or_else(|| "mpv binary not found".to_string())?;
    if let Some(parent) = std::path::Path::new(&out_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::remove_file(&out_path);

    let mut cmd = tokio::process::Command::new(&mpv_bin);
    cmd.arg("--no-terminal")
        .arg("--really-quiet")
        .arg("--no-config")
        .arg("--media-controls=no")
        .arg("--load-scripts=no")
        .arg("--cache=yes")
        .arg("--network-timeout=60")
        .arg(format!("--start={:.3}", start))
        .arg(format!("--length={:.3}", dur))
        .arg(format!("--o={}", out_path))
        .arg("--of=mp4")
        .arg("--ovc=libx264")
        .arg("--ovcopts=preset=veryfast,crf=18")
        .arg("--oac=aac")
        .arg("--oacopts=b=192k");
    if with_subs {
        if let Some(ext) = &sub_external {
            cmd.arg(format!("--sub-files={}", ext));
        } else if let Some(id) = &sub_id {
            cmd.arg(format!("--sid={}", id));
        }
        cmd.arg("--sub-visibility=yes");
        if sub_filter_sdh {
            cmd.arg("--sub-filter-sdh=yes");
        }
    } else {
        cmd.arg("--sid=no").arg("--no-sub");
    }
    cmd.arg(&src);
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    let status = cmd
        .status()
        .await
        .map_err(|e| format!("spawn mpv encode: {}", e))?;
    if !status.success() {
        let _ = std::fs::remove_file(&out_path);
        return Err(format!("clip encode failed (mpv exit {:?})", status.code()));
    }
    match std::fs::metadata(&out_path) {
        Ok(m) if m.len() > 0 => Ok(ClipResult {
            path: out_path,
            duration: dur,
        }),
        _ => Err("clip output missing".into()),
    }
}

#[tauri::command]
pub async fn mpv_screenshot_data_url(state: State<'_, MpvState>) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let mpv = {
        let g = state.inner.lock().await;
        g.as_ref()
            .map(|s| s.mpv.clone())
            .ok_or_else(|| "mpv not started".to_string())?
    };
    let temp = std::env::temp_dir().join(format!("harbor-cw-{}.jpg", Uuid::new_v4()));
    let path_str = temp.to_string_lossy().to_string();
    let _ = mpv.set_property("screenshot-format", "jpg");
    let _ = mpv.set_property("screenshot-jpeg-quality", "72");
    let _ = mpv.set_property("screenshot-high-bit-depth", "no");
    // X-Ray samples frequently. Software screenshots avoid reinitializing the
    // live video renderer for every sample, which can retain large 4K surfaces.
    let _ = mpv.set_property("screenshot-sw", "yes");
    mpv_argv_command(&mpv, &["screenshot-to-file", path_str.as_str(), "video"])
        .map_err(|e| format!("screenshot-to-file: {}", e))?;
    let mut waited = 0u64;
    while waited < 1500 {
        if temp.exists() {
            if let Ok(meta) = std::fs::metadata(&temp) {
                if meta.len() > 0 {
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
        waited += 40;
    }
    if !temp.exists() {
        return Err("screenshot file missing".to_string());
    }
    let bytes = std::fs::read(&temp).map_err(|e| format!("read: {}", e))?;
    let _ = std::fs::remove_file(&temp);
    if bytes.is_empty() {
        return Err("screenshot empty".to_string());
    }
    let encoded = B64.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{}", encoded))
}

#[tauri::command]
pub async fn mpv_on_pip_changed(
    _app: AppHandle,
    state: State<'_, MpvState>,
    entering: bool,
) -> Result<(), String> {
    let mpv = {
        let g = state.inner.lock().await;
        g.as_ref().map(|s| s.mpv.clone())
    };
    if let Some(m) = mpv {
        let _ = m.set_property("ontop", if entering { "yes" } else { "no" });
    }
    Ok(())
}

#[tauri::command]
pub async fn mpv_sub_add(
    state: State<'_, MpvState>,
    url: String,
    lang: Option<String>,
    title: Option<String>,
    select: Option<bool>,
) -> Result<(), String> {
    let mpv = {
        let g = state.inner.lock().await;
        g.as_ref()
            .map(|s| s.mpv.clone())
            .ok_or_else(|| "mpv not started".to_string())?
    };
    let url = url.replace('\\', "/");
    let flag = if select.unwrap_or(true) {
        "select"
    } else {
        "auto"
    };
    let title_input = title.filter(|s| !s.is_empty()).unwrap_or_default();
    let lang_owned = lang.filter(|s| !s.is_empty()).unwrap_or_default();
    let title_for_mpv = if !title_input.is_empty() {
        title_input
    } else if !lang_owned.is_empty() {
        lang_owned.clone()
    } else {
        "Subtitle".to_string()
    };
    let cmd_name = std::ffi::CString::new("sub-add").map_err(|e| format!("cstring: {}", e))?;
    let url_c = std::ffi::CString::new(url.as_str()).map_err(|e| format!("cstring url: {}", e))?;
    let flag_c = std::ffi::CString::new(flag).map_err(|e| format!("cstring flag: {}", e))?;
    let title_c = std::ffi::CString::new(title_for_mpv.as_str())
        .map_err(|e| format!("cstring title: {}", e))?;
    let lang_c = if lang_owned.is_empty() {
        None
    } else {
        Some(
            std::ffi::CString::new(lang_owned.as_str())
                .map_err(|e| format!("cstring lang: {}", e))?,
        )
    };
    let mut ptrs: Vec<*const std::os::raw::c_char> = vec![
        cmd_name.as_ptr(),
        url_c.as_ptr(),
        flag_c.as_ptr(),
        title_c.as_ptr(),
    ];
    if let Some(ref lc) = lang_c {
        ptrs.push(lc.as_ptr());
    }
    ptrs.push(std::ptr::null());
    let rc = unsafe { libmpv2_sys::mpv_command(mpv.ctx.as_ptr(), ptrs.as_mut_ptr()) };
    if rc < 0 {
        return Err(format!("sub-add failed: mpv_command rc={}", rc));
    }
    Ok(())
}

/// Remove an external subtitle track by its mpv track id.
///
/// A provider subtitle can be re-fetched (for example a translating addon that only
/// serves the finished file once it is ready). Removing the previous track first lets
/// the refreshed subtitle replace it instead of stacking a duplicate. mpv only allows
/// this for external subtitle files, which is exactly the case here.
#[tauri::command]
pub async fn mpv_sub_remove(state: State<'_, MpvState>, id: String) -> Result<(), String> {
    let mpv = {
        let g = state.inner.lock().await;
        g.as_ref()
            .map(|s| s.mpv.clone())
            .ok_or_else(|| "mpv not started".to_string())?
    };
    let id = id.trim();
    if id.is_empty() {
        return Err("sub-remove requires a track id".to_string());
    }
    mpv_argv_command(&mpv, &["sub-remove", id])
}

#[tauri::command]
pub async fn mpv_stop(app: AppHandle, state: State<'_, MpvState>) -> Result<(), String> {
    #[cfg(windows)]
    let _lifecycle = state.lifecycle.lock().await;
    let mut g = state.inner.lock().await;
    if let Some(session) = g.take() {
        #[cfg(windows)]
        {
            let was_off = !session.hdr_baseline_on;
            let session_monitor = session.hdr_monitor;
            if session.embedded {
                let _ = set_mpv_viewport_visible(&app, false);
            }
            let _ = session.mpv.command("quit", &[]);
            drop(session);
            drop(g);
            restore_display_sdr_if_flipped(&app, was_off, session_monitor).await;
        }
    }
    let _ = app;
    Ok(())
}

#[tauri::command]
pub async fn mpv_release_media(app: AppHandle, state: State<'_, MpvState>) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let (mpv, embedded) = {
            let g = state.inner.lock().await;
            let Some(session) = g.as_ref() else {
                return Ok(false);
            };
            (session.mpv.clone(), session.embedded)
        };
        if !embedded {
            return Ok(false);
        }
        mpv.command("stop", &[])
            .map_err(|e| format!("stop retained mpv media: {e}"))?;
        set_mpv_viewport_visible(&app, false)?;
        return Ok(true);
    }
}

#[tauri::command]
pub async fn mpv_restore_media_surface(
    app: AppHandle,
    state: State<'_, MpvState>,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let embedded = {
            let g = state.inner.lock().await;
            g.as_ref().is_some_and(|session| session.embedded)
        };
        if !embedded {
            return Ok(false);
        }
        set_mpv_viewport_visible(&app, true)?;
        return Ok(true);
    }
}

#[cfg(test)]
mod event_backoff_tests {
    use super::{record_event_poll_success, EventErrorBackoff, MPV_EVENT_MAX_CONSECUTIVE_ERRORS};
    use std::time::Duration;

    #[test]
    fn http_headers_preserve_commas_and_backslashes_in_mpv_string_lists() {
        assert_eq!(
            super::mpv_header_field("Accept-Language", "en-US,en;q=0.9"),
            "Accept-Language: en-US\\,en;q=0.9"
        );
        assert_eq!(
            super::mpv_header_field("X-Path", r"one\two,three"),
            r"X-Path: one\\two\,three"
        );
        assert_eq!(super::mpv_header_field("Accept", "*/*"), "Accept: */*");
    }

    #[test]
    fn event_error_backoff_grows_caps_and_resets() {
        let mut backoff = EventErrorBackoff::default();
        assert_eq!(backoff.next_delay(), Some(Duration::from_millis(40)));
        assert_eq!(backoff.next_delay(), Some(Duration::from_millis(80)));
        assert_eq!(backoff.next_delay(), Some(Duration::from_millis(160)));
        backoff.reset();
        assert_eq!(backoff.next_delay(), Some(Duration::from_millis(40)));
        for _ in 1..MPV_EVENT_MAX_CONSECUTIVE_ERRORS {
            let _ = backoff.next_delay();
        }
        assert_eq!(backoff.next_delay(), None);
    }

    #[test]
    fn successful_empty_poll_resets_consecutive_errors() {
        let mut backoff = EventErrorBackoff::default();
        assert_eq!(backoff.next_delay(), Some(Duration::from_millis(40)));

        record_event_poll_success(&mut backoff);

        assert_eq!(backoff.next_delay(), Some(Duration::from_millis(40)));
    }
}

#[cfg(test)]
mod extra_option_parser_tests {
    use super::parse_extra_option_lines;

    #[test]
    fn parses_key_equals_value() {
        assert_eq!(
            parse_extra_option_lines("hwdec=auto"),
            vec![("hwdec".to_string(), "auto".to_string())]
        );
    }

    #[test]
    fn parses_key_space_value() {
        assert_eq!(
            parse_extra_option_lines("hwdec auto"),
            vec![("hwdec".to_string(), "auto".to_string())]
        );
    }

    #[test]
    fn parses_bare_key_as_yes() {
        assert_eq!(
            parse_extra_option_lines("keep-open"),
            vec![("keep-open".to_string(), "yes".to_string())]
        );
    }

    #[test]
    fn strips_leading_double_dashes() {
        assert_eq!(
            parse_extra_option_lines("--hwdec=auto"),
            vec![("hwdec".to_string(), "auto".to_string())]
        );
    }

    #[test]
    fn skips_blank_lines_and_comments() {
        assert_eq!(
            parse_extra_option_lines("\n  \n# comment\n// also comment\nhwdec=auto\n"),
            vec![("hwdec".to_string(), "auto".to_string())]
        );
    }

    #[test]
    fn trims_whitespace_around_key_and_value() {
        assert_eq!(
            parse_extra_option_lines("  hwdec  =  auto  "),
            vec![("hwdec".to_string(), "auto".to_string())]
        );
    }

    #[test]
    fn drops_empty_keys() {
        assert_eq!(
            parse_extra_option_lines("--=auto\n=auto\n  =  "),
            Vec::new()
        );
    }

    #[test]
    fn preserves_duplicates_and_order() {
        assert_eq!(
            parse_extra_option_lines("hwdec=auto\nvolume=50\nhwdec=no"),
            vec![
                ("hwdec".to_string(), "auto".to_string()),
                ("volume".to_string(), "50".to_string()),
                ("hwdec".to_string(), "no".to_string()),
            ]
        );
    }
}

#[cfg(test)]
mod script_pre_init_tests {
    use super::{join_init_only_pairs, split_extra_option_pairs};

    #[test]
    fn split_partitions_init_only_keys_and_preserves_order() {
        let (init_only, rest) = split_extra_option_pairs(
            "scripts=C:\\scripts\\hdr-mode.lua\nscript-opts=hdr-mode=peak=1000\nvo=gpu\nload-scripts=yes\n",
        );
        assert_eq!(
            init_only,
            vec![
                (
                    "scripts".to_string(),
                    "C:\\scripts\\hdr-mode.lua".to_string()
                ),
                ("script-opts".to_string(), "hdr-mode=peak=1000".to_string()),
                ("load-scripts".to_string(), "yes".to_string()),
            ]
        );
        assert_eq!(rest, vec![("vo".to_string(), "gpu".to_string())]);
    }

    #[test]
    fn split_is_case_insensitive_and_folds_load_script_into_scripts() {
        let (init_only, rest) = split_extra_option_pairs(
            "Scripts=a.lua\nLOAD-SCRIPT=b.lua\nload-script=c.lua\nscale=bilinear\n",
        );
        assert_eq!(
            init_only,
            vec![
                ("scripts".to_string(), "a.lua".to_string()),
                ("scripts".to_string(), "b.lua".to_string()),
                ("scripts".to_string(), "c.lua".to_string()),
            ]
        );
        assert_eq!(rest, vec![("scale".to_string(), "bilinear".to_string())]);
    }

    #[test]
    fn join_scripts_uses_platform_separator_and_rejects_empty_entries() {
        let (init_only, _) =
            split_extra_option_pairs("scripts=a.lua\nscripts=\nload-script=b.lua\n");
        let joined = join_init_only_pairs(&init_only);
        let sep = ";";
        assert_eq!(
            joined,
            vec![("scripts".to_string(), format!("a.lua{}b.lua", sep))]
        );
    }

    #[test]
    fn join_script_opts_uses_comma() {
        let (init_only, _) = split_extra_option_pairs("script-opts=a=1\nscript-opts=b=2\n");
        assert_eq!(
            join_init_only_pairs(&init_only),
            vec![("script-opts".to_string(), "a=1,b=2".to_string())]
        );
    }

    #[test]
    fn join_load_scripts_keeps_last_non_empty_value() {
        let (init_only, _) =
            split_extra_option_pairs("load-scripts=yes\nload-scripts=\nload-scripts=no\n");
        assert_eq!(
            join_init_only_pairs(&init_only),
            vec![("load-scripts".to_string(), "no".to_string())]
        );
    }
}
