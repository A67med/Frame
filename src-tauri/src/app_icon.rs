use tauri::Manager;

#[tauri::command]
pub async fn set_app_icon(
    app: tauri::AppHandle,
    image_bytes: Option<Vec<u8>>,
) -> Result<(), String> {
    {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window is unavailable".to_string())?;
        let icon = if let Some(bytes) = image_bytes {
            tauri::image::Image::from_bytes(&bytes)
                .map_err(|e| format!("failed to decode app icon: {e}"))?
        } else {
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| "default app icon is unavailable".to_string())?
        };
        window
            .set_icon(icon)
            .map_err(|e| format!("failed to set app icon: {e}"))?;
        Ok(())
    }
}
