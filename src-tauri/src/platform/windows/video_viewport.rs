use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvGeometry {
    pub css_left: f64,
    pub css_top: f64,
    pub css_width: f64,
    pub css_height: f64,
    pub css_view_w: f64,
    pub css_view_h: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) struct NativeMpvRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) fn map_css_geometry(
    css: &MpvGeometry,
    native_width: f64,
    native_height: f64,
) -> NativeMpvRect {
    let full_surface = NativeMpvRect {
        x: 0.0,
        y: 0.0,
        width: native_width,
        height: native_height,
    };
    if !css.css_left.is_finite()
        || !css.css_top.is_finite()
        || !css.css_width.is_finite()
        || !css.css_height.is_finite()
        || !css.css_view_w.is_finite()
        || !css.css_view_h.is_finite()
        || css.css_width <= 0.0
        || css.css_height <= 0.0
        || css.css_view_w <= 0.0
        || css.css_view_h <= 0.0
    {
        return full_surface;
    }

    let scale_x = native_width / css.css_view_w;
    let scale_y = native_height / css.css_view_h;
    let mut x = css.css_left * scale_x;
    let mut y = css.css_top * scale_y;
    let mut width = css.css_width * scale_x;
    let mut height = css.css_height * scale_y;

    if css.css_left.abs() <= 2.0 {
        width += x;
        x = 0.0;
    }
    if css.css_top.abs() <= 2.0 {
        height += y;
        y = 0.0;
    }
    if css.css_left + css.css_width >= css.css_view_w - 2.0 {
        width = native_width - x;
    }
    if css.css_top + css.css_height >= css.css_view_h - 2.0 {
        height = native_height - y;
    }

    x = x.clamp(0.0, (native_width - 1.0).max(0.0));
    y = y.clamp(0.0, (native_height - 1.0).max(0.0));
    width = width.clamp(1.0, (native_width - x).max(1.0));
    height = height.clamp(1.0, (native_height - y).max(1.0));

    NativeMpvRect {
        x,
        y,
        width,
        height,
    }
}

#[cfg(windows)]
const MPV_VIEWPORT_NAME: windows::core::PCWSTR = windows::core::w!("Frame video viewport");

#[cfg(windows)]
pub(crate) static MPV_HDR_STAGE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
pub(crate) fn main_player_hwnd(
    app: &AppHandle,
) -> Result<windows::Win32::Foundation::HWND, String> {
    use windows::Win32::Foundation::HWND;
    app.get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?
        .hwnd()
        .map(|hwnd| HWND(hwnd.0))
        .map_err(|e| format!("main window handle: {e}"))
}

#[cfg(windows)]
pub(crate) fn find_mpv_viewport(
    main: windows::Win32::Foundation::HWND,
) -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::UI::WindowsAndMessaging::FindWindowExW;
    unsafe {
        FindWindowExW(
            Some(main),
            None,
            windows::core::w!("Static"),
            MPV_VIEWPORT_NAME,
        )
        .ok()
    }
}

#[cfg(windows)]
fn active_mpv_viewport(
    app: &AppHandle,
    main: windows::Win32::Foundation::HWND,
) -> Option<windows::Win32::Foundation::HWND> {
    find_mpv_viewport(main).or_else(|| {
        let pip = app.get_webview_window(crate::pip_window::PIP_LABEL)?;
        find_mpv_viewport(windows::Win32::Foundation::HWND(pip.hwnd().ok()?.0))
    })
}

#[cfg(windows)]
pub(crate) async fn ensure_mpv_viewport(app: &AppHandle) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = main_player_hwnd(&handle).and_then(|main| {
            let viewport = match active_mpv_viewport(&handle, main) {
                Some(viewport) => viewport,
                None => {
                    let viewport = create_mpv_viewport(main)?;
                    use windows::Win32::UI::WindowsAndMessaging::{
                        SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
                    };
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
                    viewport
                }
            };
            set_mpv_viewport_visible(&handle, true)?;
            Ok((viewport.0 as isize).to_string())
        });
        let _ = tx.send(result);
    })
    .map_err(|e| format!("schedule native video viewport: {e}"))?;
    rx.await
        .map_err(|e| format!("create native video viewport: {e}"))?
}

#[cfg(windows)]
fn create_mpv_viewport(
    main: windows::Win32::Foundation::HWND,
) -> Result<windows::Win32::Foundation::HWND, String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::Shell::SetWindowSubclass;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetClientRect, WINDOW_EX_STYLE, WS_CHILD, WS_CLIPCHILDREN,
    };

    // mpv fits its render window to wid. Resize this host so only mpv sizes the swapchain HWND.
    let mut rect = RECT::default();
    unsafe {
        GetClientRect(main, &mut rect).map_err(|e| format!("get main window bounds: {e}"))?;
        let viewport = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            windows::core::w!("Static"),
            MPV_VIEWPORT_NAME,
            // WebView2 covers this sibling's rectangle even where its pixels are transparent.
            WS_CHILD | WS_CLIPCHILDREN,
            0,
            0,
            rect.right.max(1),
            rect.bottom.max(1),
            Some(main),
            None,
            None,
            None,
        )
        .map_err(|e| format!("create native video viewport: {e}"))?;
        if !SetWindowSubclass(viewport, Some(mpv_viewport_proc), 0, 0).as_bool() {
            let _ = DestroyWindow(viewport);
            return Err("Cannot configure the native video viewport".into());
        }
        Ok(viewport)
    }
}

#[cfg(windows)]
unsafe extern "system" fn mpv_viewport_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::Graphics::Gdi::ValidateRect;
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{
        HTTRANSPARENT, WM_APPCOMMAND, WM_ERASEBKGND, WM_NCHITTEST, WM_PAINT,
    };
    match msg {
        WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
        WM_APPCOMMAND | WM_ERASEBKGND => LRESULT(1),
        WM_PAINT => {
            let _ = ValidateRect(Some(hwnd), None);
            LRESULT(0)
        }
        _ => DefSubclassProc(hwnd, msg, wparam, lparam),
    }
}

#[cfg(windows)]
pub(crate) fn set_mpv_viewport_visible(app: &AppHandle, visible: bool) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        SWP_SHOWWINDOW,
    };
    let viewport = active_mpv_viewport(app, main_player_hwnd(app)?)
        .ok_or_else(|| "Native video viewport is not ready".to_string())?;
    let flags = if visible {
        SWP_SHOWWINDOW
    } else {
        SWP_HIDEWINDOW
    };
    unsafe {
        SetWindowPos(
            viewport,
            None,
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | flags,
        )
        .map_err(|e| format!("set native video viewport visibility: {e}"))
    }
}

#[cfg(any(windows, test))]
fn native_pixel_bounds(native: NativeMpvRect) -> (i32, i32, i32, i32) {
    let x = native.x.round() as i32;
    let y = native.y.round() as i32;
    let right = (native.x + native.width).round() as i32;
    let bottom = (native.y + native.height).round() as i32;
    (x, y, (right - x).max(1), (bottom - y).max(1))
}

#[cfg(windows)]
pub(crate) fn position_mpv_viewport(app: &AppHandle, css: MpvGeometry) -> Result<(), String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, SetWindowPos, HWND_BOTTOM, HWND_TOP, SWP_NOACTIVATE,
    };
    let main = main_player_hwnd(app)?;
    let viewport =
        find_mpv_viewport(main).ok_or_else(|| "Native video viewport is not ready".to_string())?;
    let mut rect = RECT::default();
    unsafe { GetClientRect(main, &mut rect) }
        .map_err(|e| format!("get main window bounds: {e}"))?;
    if rect.right <= 0 || rect.bottom <= 0 {
        return Ok(());
    }
    let native = map_css_geometry(&css, rect.right as f64, rect.bottom as f64);
    let (x, y, width, height) = native_pixel_bounds(native);
    let z = if MPV_HDR_STAGE.load(std::sync::atomic::Ordering::Relaxed)
        && app
            .get_webview_window(crate::hdr_overlay::HDR_OVERLAY_LABEL)
            .is_some()
    {
        HWND_TOP
    } else {
        HWND_BOTTOM
    };
    unsafe {
        SetWindowPos(viewport, Some(z), x, y, width, height, SWP_NOACTIVATE)
            .map_err(|e| format!("position native video viewport: {e}"))
    }
}

#[cfg(test)]
mod geometry_tests {
    use super::{map_css_geometry, native_pixel_bounds, MpvGeometry, NativeMpvRect};

    #[test]
    fn rounds_shared_viewport_edges_to_the_same_pixel() {
        let left = NativeMpvRect {
            x: 0.0,
            y: 1.6,
            width: 50.6,
            height: 10.6,
        };
        let right = NativeMpvRect {
            x: left.x + left.width,
            width: 49.4,
            ..left
        };
        assert_eq!(native_pixel_bounds(left), (0, 2, 51, 10));
        assert_eq!(native_pixel_bounds(right), (51, 2, 49, 10));
    }

    #[test]
    fn mpv_geometry_maps_a_zoomed_full_viewport_to_the_full_native_surface() {
        let css = MpvGeometry {
            css_left: 0.0,
            css_top: 0.0,
            css_width: 1221.428571,
            css_height: 742.857143,
            css_view_w: 1221.428571,
            css_view_h: 742.857143,
        };

        assert_eq!(
            map_css_geometry(&css, 1710.0, 1040.0),
            NativeMpvRect {
                x: 0.0,
                y: 0.0,
                width: 1710.0,
                height: 1040.0
            }
        );
    }

    #[test]
    fn mpv_geometry_scales_partial_rectangles_on_each_axis() {
        let css = MpvGeometry {
            css_left: 10.0,
            css_top: 20.0,
            css_width: 500.0,
            css_height: 300.0,
            css_view_w: 1000.0,
            css_view_h: 800.0,
        };

        assert_eq!(
            map_css_geometry(&css, 2000.0, 1200.0),
            NativeMpvRect {
                x: 20.0,
                y: 30.0,
                width: 1000.0,
                height: 450.0
            }
        );
    }

    #[test]
    fn mpv_geometry_falls_back_to_the_native_surface_for_invalid_viewports() {
        let css = MpvGeometry {
            css_left: 40.0,
            css_top: 30.0,
            css_width: 500.0,
            css_height: 300.0,
            css_view_w: 0.0,
            css_view_h: f64::NAN,
        };

        assert_eq!(
            map_css_geometry(&css, 1920.0, 1080.0),
            NativeMpvRect {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0
            }
        );
    }
}
