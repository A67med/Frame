// Maximised windows are clamped to the work area so they never cover the taskbar.
// Fullscreen must cover it, so the clamp is lifted while fullscreen is active.
#[cfg(desktop)]
static MAXGUARD_CLAMP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[cfg(desktop)]
#[tauri::command]
pub(crate) fn set_maximize_clamp(enabled: bool) {
    MAXGUARD_CLAMP.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(windows)]
pub(crate) fn make_main_transparent(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[harbor::transparent] main window missing");
        return;
    };
    let res = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Controller2, COREWEBVIEW2_COLOR,
        };
        use windows::core::Interface;
        let controller = webview.controller();
        match controller.cast::<ICoreWebView2Controller2>() {
            Ok(controller2) => {
                let color = COREWEBVIEW2_COLOR {
                    A: 0,
                    R: 0,
                    G: 0,
                    B: 0,
                };
                match controller2.SetDefaultBackgroundColor(color) {
                    Ok(()) => {
                        eprintln!("[harbor::transparent] SetDefaultBackgroundColor OK (alpha=0)")
                    }
                    Err(e) => eprintln!(
                        "[harbor::transparent] SetDefaultBackgroundColor FAILED: {:?}",
                        e
                    ),
                }
            }
            Err(e) => eprintln!("[harbor::transparent] cast to Controller2 FAILED: {:?}", e),
        }
    });
    if let Err(e) = res {
        eprintln!("[harbor::transparent] with_webview FAILED: {:?}", e);
    }
}

#[cfg(windows)]
pub(crate) fn force_show_foreground(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        let _ = SetForegroundWindow(hwnd);
    }
}

#[cfg(windows)]
const HARBOR_MAXGUARD_SUBCLASS_ID: usize = 0x4842_4D47;

#[cfg(windows)]
static MAIN_IN_SIZE_MOVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
unsafe extern "system" fn maxguard_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{
        MINMAXINFO, WM_ENTERSIZEMOVE, WM_ERASEBKGND, WM_EXITSIZEMOVE, WM_GETMINMAXINFO,
        WM_NCDESTROY,
    };
    if msg == WM_ENTERSIZEMOVE {
        MAIN_IN_SIZE_MOVE.store(true, std::sync::atomic::Ordering::Relaxed);
    } else if msg == WM_EXITSIZEMOVE || msg == WM_NCDESTROY {
        MAIN_IN_SIZE_MOVE.store(false, std::sync::atomic::Ordering::Relaxed);
    }
    // Suppress repeated erases only during an interactive move/resize, where
    // the WebView and mpv repaint asynchronously. Outside that loop, let Tao
    // paint the configured black background before transparent content appears.
    if msg == WM_ERASEBKGND && MAIN_IN_SIZE_MOVE.load(std::sync::atomic::Ordering::Relaxed) {
        return windows::Win32::Foundation::LRESULT(1);
    }
    let res = DefSubclassProc(hwnd, msg, wparam, lparam);
    if msg == WM_GETMINMAXINFO && MAXGUARD_CLAMP.load(std::sync::atomic::Ordering::Relaxed) {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut mi).as_bool() {
            let mmi = &mut *(lparam.0 as *mut MINMAXINFO);
            mmi.ptMaxPosition.x = mi.rcWork.left - mi.rcMonitor.left;
            mmi.ptMaxPosition.y = mi.rcWork.top - mi.rcMonitor.top;
            mmi.ptMaxSize.x = mi.rcWork.right - mi.rcWork.left;
            mmi.ptMaxSize.y = mi.rcWork.bottom - mi.rcWork.top;
        }
    }
    if matches!(
        msg,
        windows::Win32::UI::WindowsAndMessaging::WM_NCPAINT
            | windows::Win32::UI::WindowsAndMessaging::WM_NCACTIVATE
    ) && MAXGUARD_CLAMP.load(std::sync::atomic::Ordering::Relaxed)
    {
        paint_main_taskbar_gap(hwnd);
    }
    res
}

#[cfg(windows)]
unsafe fn paint_main_taskbar_gap(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        ClientToScreen, FillRect, GetMonitorInfoW, GetStockObject, GetWindowDC, MonitorFromWindow,
        ReleaseDC, BLACK_BRUSH, HBRUSH, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect, IsZoomed};
    if !IsZoomed(hwnd).as_bool() {
        return;
    }
    let mut client = RECT::default();
    let mut outer = RECT::default();
    let mut origin = POINT::default();
    let mut monitor = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if GetClientRect(hwnd, &mut client).is_err()
        || GetWindowRect(hwnd, &mut outer).is_err()
        || !ClientToScreen(hwnd, &mut origin).as_bool()
        || !GetMonitorInfoW(
            MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
            &mut monitor,
        )
        .as_bool()
    {
        return;
    }
    let work = monitor.rcWork;
    // Tao reserves one nonclient pixel for an auto-hidden taskbar. The WebView
    // cannot paint it. Own that strip's paint without changing its hit testing,
    // the client bounds, or the normal restored-window frame.
    if origin.x != work.left
        || origin.y != work.top
        || origin.x + client.right != work.right
        || origin.y + client.bottom != work.bottom - 1
        || outer.left > work.left
        || outer.right < work.right
        || outer.top > work.bottom - 1
        || outer.bottom < work.bottom
    {
        return;
    }
    let dc = GetWindowDC(Some(hwnd));
    if dc.0.is_null() {
        return;
    }
    let strip = RECT {
        left: work.left - outer.left,
        right: work.right - outer.left,
        top: work.bottom - 1 - outer.top,
        bottom: work.bottom - outer.top,
    };
    let brush = HBRUSH(GetStockObject(BLACK_BRUSH).0);
    let _ = FillRect(dc, &strip, brush);
    let _ = ReleaseDC(Some(hwnd), dc);
}

#[cfg(windows)]
pub(crate) fn install_maximize_guard(app: &tauri::AppHandle) {
    use tauri::Manager;
    use windows::Win32::UI::Shell::SetWindowSubclass;
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[harbor::maxguard] main window missing");
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        eprintln!("[harbor::maxguard] hwnd unavailable");
        return;
    };
    unsafe {
        let _ = SetWindowSubclass(
            hwnd,
            Some(maxguard_subclass_proc),
            HARBOR_MAXGUARD_SUBCLASS_ID,
            0,
        );
    }
    eprintln!("[harbor::maxguard] WM_GETMINMAXINFO work-area guard installed");
}

// Opt-in geometry-only diagnostics: never log player URLs or account data.
#[cfg(windows)]
pub(crate) fn log_main_geometry(app: &tauri::AppHandle, reason: &'static str) {
    use tauri::Manager;
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if !*ENABLED.get_or_init(|| std::env::var_os("HARBOR_WINDOW_DIAGNOSTICS").is_some()) {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let native_window = window.clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(hwnd) = native_window.hwnd() else { return };
        use windows::Win32::Foundation::{POINT, RECT};
        use windows::Win32::Graphics::Gdi::{ClientToScreen, GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
        use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect, IsZoomed};
        let mut outer = RECT::default();
        let mut client = RECT::default();
        let mut origin = POINT::default();
        let mut bounds = RECT::default();
        let mut monitor = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let outer_ok = GetWindowRect(hwnd, &mut outer).is_ok();
        let client_ok = GetClientRect(hwnd, &mut client).is_ok();
        let origin_ok = ClientToScreen(hwnd, &mut origin).as_bool();
        let monitor_ok = GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut monitor).as_bool();
        let bounds_ok = webview.controller().Bounds(&mut bounds).is_ok();
        eprintln!("[harbor::window-geometry] {reason} zoomed={} outer={outer:?}/{outer_ok} client={client:?}/{client_ok} origin={origin:?}/{origin_ok} webview={bounds:?}/{bounds_ok} monitor={:?} work={:?}/{monitor_ok}", IsZoomed(hwnd).as_bool(), monitor.rcMonitor, monitor.rcWork);
    });
}

#[cfg(desktop)]
const REVEAL_FAILSAFE_MS: u64 = 12_000;

#[cfg(desktop)]
pub(crate) fn install_reveal_failsafe(app: &tauri::AppHandle) {
    use tauri::Manager;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(REVEAL_FAILSAFE_MS));
        let Some(window) = handle.get_webview_window("main") else {
            return;
        };
        if matches!(window.is_visible(), Ok(true)) {
            return;
        }
        eprintln!(
            "[harbor::reveal] page load did not finish in {REVEAL_FAILSAFE_MS}ms, showing window anyway"
        );
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    });
}

#[cfg(desktop)]
pub(crate) fn ensure_window_on_screen(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let (pos, size) = match (window.outer_position(), window.outer_size()) {
        (Ok(p), Ok(s)) => (p, s),
        _ => return,
    };
    let monitors = match window.available_monitors() {
        Ok(m) if !m.is_empty() => m,
        _ => return,
    };
    let ww = size.width as i32;
    let wh = size.height as i32;
    let on_screen = monitors.iter().any(|m| {
        let mp = m.position();
        let ms = m.size();
        pos.x < mp.x + ms.width as i32
            && pos.x + ww > mp.x
            && pos.y < mp.y + ms.height as i32
            && pos.y + wh > mp.y
    });
    if on_screen {
        return;
    }
    let target = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.into_iter().next());
    let Some(mon) = target else {
        return;
    };
    let mp = mon.position();
    let ms = mon.size();
    let cx = mp.x + (ms.width as i32 - ww).max(0) / 2;
    let cy = mp.y + (ms.height as i32 - wh).max(0) / 2;
    let _ = window.set_position(tauri::PhysicalPosition::new(cx, cy));
    eprintln!(
        "[harbor::window] launched off-screen; recentered to {},{}",
        cx, cy
    );
}
