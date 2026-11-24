use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

#[derive(serde::Serialize)]
pub struct SvpStatus {
    supported: bool,
    reason: Option<String>,
    installed: bool,
    ready: bool,
    loadable: Option<bool>,
    load_error: Option<String>,
}

static LAST_LOAD: Mutex<Option<Result<(), String>>> = Mutex::new(None);

#[cfg(windows)]
fn svp_root() -> Option<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("C:\\Program Files (x86)\\SVP 4"),
        PathBuf::from("C:\\Program Files\\SVP 4"),
    ];
    for env in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(path) = std::env::var(env) {
            candidates.push(PathBuf::from(&path).join("SVP 4"));
            candidates.push(PathBuf::from(&path).join("Programs").join("SVP 4"));
        }
    }
    candidates
        .into_iter()
        .find(|root| root.join("SVPManager.exe").exists())
}

fn find_file(root: &Path, names: &[&str], depth: u32) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let entries = std::fs::read_dir(root).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            subdirs.push(path);
        } else if path.file_name().is_some_and(|name| {
            let name = name.to_string_lossy();
            names
                .iter()
                .any(|candidate| name.eq_ignore_ascii_case(candidate))
        }) {
            return Some(path);
        }
    }
    subdirs
        .into_iter()
        .find_map(|dir| find_file(&dir, names, depth - 1))
}

#[cfg(windows)]
fn dir_has_python(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        name.starts_with("python3") && name.ends_with(".dll")
    })
}

#[cfg(windows)]
fn vsscript_file(root: Option<&Path>) -> Option<PathBuf> {
    let root = root?;
    let mut candidates = Vec::new();
    collect_files(root, &["VSScript.dll"], 5, &mut candidates);
    candidates.sort_by_key(|path| {
        let parent = path.parent().unwrap_or(root);
        (
            !dir_has_python(parent),
            !parent.to_string_lossy().contains("64"),
        )
    });
    candidates.into_iter().next()
}

#[cfg(windows)]
fn collect_files(root: &Path, names: &[&str], depth: u32, output: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, names, depth - 1, output);
        } else if path.file_name().is_some_and(|name| {
            let name = name.to_string_lossy();
            names
                .iter()
                .any(|candidate| name.eq_ignore_ascii_case(candidate))
        }) {
            output.push(path);
        }
    }
}

#[cfg(windows)]
fn svpflow_plugins(root: &Path) -> Option<(PathBuf, PathBuf)> {
    let flow1 = find_file(root, &["svpflow1_vs.dll", "svpflow1_vs64.dll"], 6)?;
    let flow2 = find_file(root, &["svpflow2_vs.dll", "svpflow2_vs64.dll"], 6)?;
    Some((flow1, flow2))
}

#[cfg(windows)]
fn preload_vsscript_chain(file: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::LibraryLoader::{LoadLibraryExW, LOAD_WITH_ALTERED_SEARCH_PATH};

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
    fn load(path: &Path) -> Result<(), u32> {
        let wide = wide(path);
        unsafe {
            LoadLibraryExW(PCWSTR(wide.as_ptr()), None, LOAD_WITH_ALTERED_SEARCH_PATH)
                .map(|_| ())
                .map_err(|error| (error.code().0 as u32) & 0xffff)
        }
    }

    let dir = file
        .parent()
        .ok_or_else(|| "VSScript directory missing".to_string())?;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name.starts_with("python3") && name.ends_with(".dll") {
                let _ = load(&entry.path());
            }
        }
    }
    let _ = load(&dir.join("vapoursynth.dll"));
    load(file).map_err(|code| format!("VSScript.dll failed to load (0x{:x})", code))
}

#[cfg(windows)]
fn crt_set_vsscript_path(value: &str) {
    use windows::core::{s, PCWSTR};
    use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};

    let entry: Vec<u16> = format!("VSSCRIPT_PATH={}", value)
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    for module in ["ucrtbase.dll\0", "msvcrt.dll\0"] {
        let module: Vec<u16> = module.encode_utf16().collect();
        unsafe {
            let Ok(handle) = GetModuleHandleW(PCWSTR(module.as_ptr())) else {
                continue;
            };
            if let Some(proc) = GetProcAddress(handle, s!("_wputenv")) {
                let set_env: unsafe extern "C" fn(*const u16) -> i32 = std::mem::transmute(proc);
                let _ = set_env(entry.as_ptr());
            }
        }
    }
}

pub fn prime_svp_env() {
    let Some(root) = svp_root() else {
        return;
    };
    let Some(vsscript) = vsscript_file(Some(&root)) else {
        return;
    };
    let vsscript_string = vsscript.to_string_lossy().into_owned();
    std::env::set_var("VSSCRIPT_PATH", &vsscript_string);

    #[cfg(windows)]
    {
        if let Some(dir) = vsscript.parent() {
            let dir = dir.to_string_lossy().into_owned();
            let current = std::env::var("PATH").unwrap_or_default();
            if !current
                .split(';')
                .any(|entry| entry.eq_ignore_ascii_case(&dir))
            {
                std::env::set_var("PATH", format!("{};{}", dir, current));
            }
        }
        let result = preload_vsscript_chain(&vsscript);
        crt_set_vsscript_path(&vsscript_string);
        if let Ok(mut guard) = LAST_LOAD.lock() {
            *guard = Some(result);
        }
    }
}

#[tauri::command]
pub fn svp_status() -> SvpStatus {
    let root = svp_root();
    let ready = root
        .as_ref()
        .is_some_and(|root| svpflow_plugins(root).is_some() && vsscript_file(Some(root)).is_some());
    let (loadable, load_error) = match LAST_LOAD.lock().ok().and_then(|guard| guard.clone()) {
        Some(Ok(())) => (Some(true), None),
        Some(Err(message)) => (Some(false), Some(message)),
        None => (None, None),
    };
    SvpStatus {
        supported: true,
        reason: None,
        installed: root.is_some(),
        ready,
        loadable,
        load_error,
    }
}

#[cfg(windows)]
fn manager_executable(root: &Path) -> Option<PathBuf> {
    let path = root.join("SVPManager.exe");
    path.is_file().then_some(path)
}

#[cfg(windows)]
fn svp_manager_running() -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    let snapshot = match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) } {
        Ok(handle) => handle,
        Err(_) => return false,
    };
    let mut found = false;
    unsafe {
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&character| character == 0)
                    .unwrap_or(entry.szExeFile.len());
                if String::from_utf16_lossy(&entry.szExeFile[..len])
                    .eq_ignore_ascii_case("SVPManager.exe")
                {
                    found = true;
                    break;
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    found
}

fn launch_svp_manager() -> Result<(), String> {
    let root = svp_root().ok_or_else(|| "SVP Manager is not installed".to_string())?;
    let executable = manager_executable(&root)
        .ok_or_else(|| "SVP Manager executable was not found".to_string())?;
    std::process::Command::new(&executable)
        .current_dir(&root)
        .spawn()
        .map_err(|error| format!("launch SVP Manager: {}", error))?;
    Ok(())
}

#[tauri::command]
pub fn svp_launch() -> Result<(), String> {
    launch_svp_manager()
}

#[tauri::command]
pub fn svp_ensure_running() -> Result<bool, String> {
    {
        if svp_manager_running() {
            return Ok(false);
        }
        let Some(root) = svp_root() else {
            return Ok(false);
        };
        if manager_executable(&root).is_none() {
            return Ok(false);
        }
        launch_svp_manager()?;
        Ok(true)
    }
}

const VPY_TEMPLATE: &str = r#"import vapoursynth as vs
from fractions import Fraction
core = vs.core

if not hasattr(core, "svp1"):
    core.std.LoadPlugin(__FLOW1__)
if not hasattr(core, "svp2"):
    core.std.LoadPlugin(__FLOW2__)

clip = video_in
_f = clip.format
if _f is None or _f.color_family != vs.YUV or _f.bits_per_sample != 8 or _f.subsampling_w != 1 or _f.subsampling_h != 1:
    clip = core.resize.Bicubic(clip, format=vs.YUV420P8, dither_type="error_diffusion")
src = container_fps if container_fps and container_fps > 1 else 23.976

target = __TARGET__
if target == -1:
    target = src * 2
elif target <= 0:
    target = display_fps if display_fps and display_fps > src else src * 2
if target < src:
    target = src

fr = Fraction(target / src).limit_denominator(1000)
num, den = fr.numerator, fr.denominator

sup = core.svp1.Super(clip, "{gpu:1}")
vec = core.svp1.Analyse(sup["clip"], sup["data"], clip, "{}")
smooth = core.svp2.SmoothFps(clip, sup["clip"], sup["data"], vec["clip"], vec["data"],
    "{rate:{num:%d,den:%d},algo:13,mask:{cover:80}}" % (num, den), src=clip, fps=src)
smooth = core.std.AssumeFPS(smooth, fpsnum=int(round(src * num / den * 1000)), fpsden=1000)
smooth.set_output()
"#;

fn target_value(target_fps: &str) -> &str {
    match target_fps {
        "double" => "-1",
        "48" => "48",
        "60" => "60",
        _ => "0",
    }
}

fn make_script(flow1: &Path, flow2: &Path, target_fps: &str) -> Result<String, String> {
    let flow1 =
        serde_json::to_string(&flow1.to_string_lossy()).map_err(|error| error.to_string())?;
    let flow2 =
        serde_json::to_string(&flow2.to_string_lossy()).map_err(|error| error.to_string())?;
    Ok(VPY_TEMPLATE
        .replace("__FLOW1__", &flow1)
        .replace("__FLOW2__", &flow2)
        .replace("__TARGET__", target_value(target_fps)))
}

#[tauri::command]
pub fn svp_apply(app: tauri::AppHandle, target_fps: String) -> Result<String, String> {
    let root = svp_root().ok_or_else(|| "SVP is not installed".to_string())?;
    let (flow1, flow2) = svpflow_plugins(&root)
        .ok_or_else(|| "svpflow plugins were not found in the SVP install".to_string())?;
    vsscript_file(Some(&root))
        .ok_or_else(|| "VapourSynth script library was not found".to_string())?;

    let output_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("svp");
    std::fs::create_dir_all(&output_dir).map_err(|error| format!("create dir: {}", error))?;
    let script = make_script(&flow1, &flow2, &target_fps)?;
    let vpy = output_dir.join("svp.vpy");
    std::fs::write(&vpy, script).map_err(|error| format!("write vpy: {}", error))?;
    Ok(vpy.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_uses_exact_native_plugin_paths() {
        let script = make_script(
            Path::new("/opt/svp/plugins/libsvpflow1.so"),
            Path::new("/opt/svp/plugins/libsvpflow2.so"),
            "60",
        )
        .unwrap();
        assert!(script.contains("if not hasattr(core, \"svp1\")"));
        assert!(script.contains("core.std.LoadPlugin(\"/opt/svp/plugins/libsvpflow1.so\")"));
        assert!(script.contains("if not hasattr(core, \"svp2\")"));
        assert!(script.contains("core.std.LoadPlugin(\"/opt/svp/plugins/libsvpflow2.so\")"));
        assert!(script.contains("target = 60"));
        assert!(!script.contains(".dll"));
    }

    #[test]
    fn target_modes_are_mapped() {
        assert_eq!(target_value("double"), "-1");
        assert_eq!(target_value("48"), "48");
        assert_eq!(target_value("60"), "60");
        assert_eq!(target_value("display"), "0");
    }
}
