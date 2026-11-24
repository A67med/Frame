#[tauri::command]
pub(crate) fn harbor_set_webview_memory_low(app: tauri::AppHandle, low: bool) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(move |webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows::core::Interface;
        let controller = webview.controller();
        if let Ok(core) = controller.CoreWebView2() {
            if let Ok(w3) = core.cast::<ICoreWebView2_19>() {
                let level = if low {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                };
                let _ = w3.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

#[tauri::command]
pub(crate) fn harbor_set_webview_visible(app: tauri::AppHandle, visible: bool) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(move |webview| unsafe {
        let _ = webview.controller().SetIsVisible(visible);
    });
}

#[tauri::command]
pub(crate) fn harbor_set_context_menu(app: tauri::AppHandle, enabled: bool) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(move |webview| unsafe {
        let controller = webview.controller();
        if let Ok(core) = controller.CoreWebView2() {
            if let Ok(settings) = core.Settings() {
                let _ = settings.SetAreDefaultContextMenusEnabled(enabled);
            }
        }
    });
}

#[tauri::command]
pub(crate) fn harbor_try_suspend_webview(app: tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(move |webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use webview2_com::TrySuspendCompletedHandler;
        use windows::core::Interface;
        let controller = webview.controller();
        let _ = controller.SetIsVisible(false);
        if let Ok(core) = controller.CoreWebView2() {
            if let Ok(c3) = core.cast::<ICoreWebView2_3>() {
                let handler = TrySuspendCompletedHandler::create(Box::new(|_hr, _ok| Ok(())));
                let _ = c3.TrySuspend(&handler);
            }
        }
    });
}

#[tauri::command]
pub(crate) fn harbor_resume_webview(app: tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(move |webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use windows::core::Interface;
        let controller = webview.controller();
        if let Ok(core) = controller.CoreWebView2() {
            if let Ok(c3) = core.cast::<ICoreWebView2_3>() {
                let _ = c3.Resume();
            }
        }
        let _ = controller.SetIsVisible(true);
    });
}
