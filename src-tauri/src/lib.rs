mod binary_lookup;
mod cast_hls;
mod cast_subs;
mod crash_report;
mod diagnostics;
mod download;
mod features;
mod fonts;
mod gamepad;
mod infrastructure;
mod platform;
use infrastructure::networking::http_fetch;
use platform::windows::launch_args;
use platform::windows::main_window::{
    self, ensure_window_on_screen, force_show_foreground, install_maximize_guard,
    install_reveal_failsafe, log_main_geometry, make_main_transparent,
};
mod media_server;
mod power;
mod privacy;
mod proc_guard;
mod proc_mem;
mod stream_proxy;
use features::addons::streams;
mod mal_auth;
mod remote_auth;
mod stremio_auth;
mod temp_prune;
mod thumb_cache;
mod torrent_engine;
mod transcode;
mod web_server;

mod airplay;
mod anime4k;
mod app_icon;
mod asr_model;
mod browser;
mod browser_args;
use features::addons::capstan;
mod captions;
mod cast;
mod cast_server;
mod cf_relay;
mod cf_solver;
mod desktop_notify;
mod discord_rp;
mod display_fit;
mod dlna;
mod dvr;
mod fullscreen;
mod harbor_lan;
mod hdr_overlay;
mod monitors;
use platform::windows::media_controls;
#[cfg(target_os = "windows")]
use platform::windows::taskbar;
mod modal_overlay;
use features::playback::mpv;
mod multiview;
mod pip;
mod pip_window;
mod roku;
mod shaders;
mod song_id;
mod song_id_gemini;
mod subsync;
mod svp;
mod text_files;
mod thumbs;
mod trailer;
mod tray;
mod webview_helpers;
#[cfg(windows)]
use platform::windows::win_graphics;

#[cfg(desktop)]
pub(crate) fn shutdown_services(app: &tauri::AppHandle) {
    launch_args::release_stremio_scheme(app);
    thumbs::shutdown(app);
    multiview::shutdown(app);
    dvr::shutdown(app);
    stream_proxy::shutdown(app);
    cast_server::stop();
    torrent_engine::stop();
    discord_rp::shutdown(app);
    crash_report::mark_clean_exit();
}

#[cfg(desktop)]
pub static CLOSE_FLUSH_DONE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(desktop)]
static CLOSE_IN_PROGRESS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(desktop)]
#[tauri::command]
fn harbor_flush_done() {
    CLOSE_FLUSH_DONE.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(desktop)]
#[tauri::command]
fn harbor_startup_ready(window: tauri::WebviewWindow) {
    if window.label() == "main" {
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
#[tauri::command]
fn close_aux_windows(app: tauri::AppHandle) {
    use tauri::Manager;
    for (label, window) in app.webview_windows() {
        if label != "main" {
            let _ = window.close();
        }
    }
}

pub(crate) use text_files::save_text_file;

#[cfg(desktop)]
pub fn run() {
    features::profiles::legacy_data::migrate();
    launch_args::capture_startup_media_arg();
    svp::prime_svp_env();
    #[cfg(windows)]
    win_graphics::configure_windows_graphics();
    #[cfg(windows)]
    taskbar::register_app_identity();
    let _ = rustls::crypto::ring::default_provider().install_default();
    trailer::sweep_cache();
    std::thread::spawn(trailer::sweep_ytdlp_extractions);
    std::thread::spawn(temp_prune::sweep_temp);

    let proxy_state = tauri::async_runtime::block_on(stream_proxy::ProxyState::start())
        .unwrap_or_else(|e| {
            eprintln!("[stream-proxy] failed to start: {}", e);
            stream_proxy::ProxyState::placeholder()
        });
    let mpv_state = mpv::MpvState::new();
    let pip_state = pip::PipState::new();
    let pip_window_state = pip_window::PipWindowState::default();
    let fullscreen_state = fullscreen::FullscreenState::new();
    let thumbs_state = thumbs::ThumbsState::new();
    let dvr_state = dvr::DvrState::new();
    let multiview_state = multiview::MultiviewState::new();
    let modal_overlay_state = modal_overlay::ModalOverlayState::new();
    let app_builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
                #[cfg(windows)]
                force_show_foreground(&w);
            } else {
                eprintln!("[harbor::single-instance] no main window to focus, releasing the lock");
                app.exit(0);
                return;
            }
            if let Some(url) = args
                .iter()
                .find(|a| a.starts_with("frame://") || a.starts_with("harbor://"))
            {
                let _ = app.emit("harbor:stremio-deeplink", url.clone());
            }
            if let Some(path) = launch_args::media_file_from_args(&args) {
                let _ = app.emit("harbor:open-file", path);
            }
        }))
        // tauri-plugin-opener injects a page script that itself opens target="_blank" anchors, duplicating Frame's own openUrl.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin({
            let builder = tauri_plugin_window_state::Builder::default().with_state_flags(
                tauri_plugin_window_state::StateFlags::SIZE
                    | tauri_plugin_window_state::StateFlags::POSITION
                    | tauri_plugin_window_state::StateFlags::MAXIMIZED,
            );
            // Restore the Windows main window only after its maximize guard is
            // installed, so startup uses the same work-area rules as user maximize.
            #[cfg(windows)]
            let builder = builder.skip_initial_state("main");
            builder.build()
        })
        .manage(proxy_state)
        .manage(mpv_state)
        .manage(pip_state)
        .manage(pip_window_state)
        .manage(fullscreen_state)
        .manage(thumbs_state)
        .manage(dvr_state)
        .manage(multiview_state)
        .manage(modal_overlay_state)
        .manage(discord_rp::DiscordState::new())
        .manage(download::DownloadState::new());

    app_builder
        .plugin(privacy::init())
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                let _ = webview.window().show();
            }
        })
        .setup(move |app| {
            if features::profiles::legacy_data::failed() {
                use tauri_plugin_dialog::DialogExt;
                app.dialog()
                    .message("Frame couldn't copy your Harbor data on this launch, so it's starting without it. Your original data has not been changed. Close Harbor if it's open, then restart Frame to try again.")
                    .title("Frame")
                    .show(|_| {});
            }
            if let Err(error) = crash_report::initialize(app.handle()) {
                eprintln!("[harbor::crash-report] initialization failed: {error}");
            }
            proc_guard::init();
            proc_guard::reap_orphans();
            #[cfg(windows)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("[harbor::deep-link] register_all failed: {:?}", e);
                }
            }
            #[cfg(windows)]
            make_main_transparent(&app.handle());
            #[cfg(windows)]
            install_maximize_guard(&app.handle());
            #[cfg(windows)]
            {
                use tauri::Manager;
                use tauri_plugin_window_state::{StateFlags, WindowExt};
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.restore_state(
                        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                    ) {
                        eprintln!("[harbor::window] startup restore failed: {error}");
                    }
                }
            }
            display_fit::install(app.handle());
            install_reveal_failsafe(app.handle());
            ensure_window_on_screen(&app.handle());
            cast_server::ensure_started_on_setup(&app.handle());
            torrent_engine::ensure_started_on_setup(&app.handle());
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    use tauri::Manager;
                    if let Ok(base) = handle.path().app_cache_dir() {
                        let _ = temp_prune::sweep_mpv_cache(base.join("mpv-cache"));
                    }
                });
            }
            media_controls::ensure_started_on_setup(&app.handle());
            #[cfg(target_os = "windows")]
            taskbar::init(&app.handle());
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || discord_rp::run_loop(handle));
            }
            gamepad::spawn(app.handle().clone());
            #[cfg(desktop)]
            if let Err(e) = tray::build(&app.handle()) {
                eprintln!("[harbor::tray] build failed: {:?}", e);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            use tauri::Manager;
            #[cfg(windows)]
            if matches!(
                event,
                tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) && window
                .app_handle()
                .get_webview_window(hdr_overlay::HDR_OVERLAY_LABEL)
                .is_some()
            {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = hdr_overlay::hdr_overlay_sync(app).await;
                });
            }
            #[cfg(windows)]
            match event {
                tauri::WindowEvent::Resized(_) => log_main_geometry(window.app_handle(), "resized"),
                tauri::WindowEvent::Moved(_) => log_main_geometry(window.app_handle(), "moved"),
                tauri::WindowEvent::Focused(true) => {
                    log_main_geometry(window.app_handle(), "focused")
                }
                _ => {}
            }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if tray::close_to_tray() {
                        api.prevent_close();
                        let _ = window.hide();
                    } else if !CLOSE_IN_PROGRESS.swap(true, std::sync::atomic::Ordering::SeqCst) {
                        use tauri::Emitter;
                        api.prevent_close();
                        CLOSE_FLUSH_DONE.store(false, std::sync::atomic::Ordering::SeqCst);
                        let _ = window.emit("harbor://app-closing", ());
                        let w = window.clone();
                        std::thread::spawn(move || {
                            for _ in 0..24 {
                                if CLOSE_FLUSH_DONE.load(std::sync::atomic::Ordering::SeqCst) {
                                    break;
                                }
                                std::thread::sleep(std::time::Duration::from_millis(50));
                            }
                            let _ = w.destroy();
                        });
                    }
                }
                tauri::WindowEvent::Focused(focused) => {
                    use tauri::Emitter;
                    gamepad::set_window_focused(*focused);
                    if *focused
                        && (pip::window_pip_is_active(window.app_handle())
                            || tray::always_on_top_pref())
                    {
                        let _ = window.set_always_on_top(true);
                    }
                    let minimized = if *focused {
                        false
                    } else {
                        window.is_minimized().unwrap_or(false)
                            || !window.is_visible().unwrap_or(true)
                    };
                    let _ = window.emit(
                        "harbor://window-activity",
                        serde_json::json!({ "focused": *focused, "minimized": minimized }),
                    );
                }
                tauri::WindowEvent::Destroyed => {
                    shutdown_services(window.app_handle());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            privacy::privacy_status,
            privacy::privacy_set_enabled,
            main_window::set_maximize_clamp,
            monitors::list_monitors,
            monitors::move_main_to_monitor,
            crash_report::take_startup_crash_report,
            fonts::install_sub_font,
            fonts::remove_sub_font,
            fonts::list_sub_fonts,
            harbor_flush_done,
            harbor_startup_ready,
            close_aux_windows,
            desktop_notify::send_clickable_notification,
            features::installer::handoff::handoff_probe,
            features::installer::handoff::handoff_stage,
            features::installer::handoff::handoff_launch,
            features::installer::handoff::handoff_confirm,
            features::installer::handoff::handoff_save_backup,
            power::power_inhibit,
            platform::windows::webview::harbor_set_webview_memory_low,
            platform::windows::webview::harbor_set_webview_visible,
            platform::windows::webview::harbor_set_context_menu,
            platform::windows::webview::harbor_try_suspend_webview,
            platform::windows::webview::harbor_resume_webview,
            save_text_file,
            text_files::save_text_file_as,
            subsync::moviehash::compute_moviehash,
            subsync::sync_subtitle,
            subsync::scorer::subsync_score_transform,
            subsync::scorer::subsync_preflight_candidates,
            subsync::torrent_sync::torrent_sync_availability,
            subsync::torrent_sync::torrent_sync_subtitle,
            subsync::torrent_sync::torrent_score_transform,
            subsync::audio_tracks::audio_probe_tracks,
            subsync::fingerprint::compute_chromaprint,
            subsync::asr::asr_transcribe_windows,
            subsync::asr::asr_verify,
            features::subtitles::extract::subtitle_extract,
            features::subtitles::extract::subtitle_extract_ass,
            cast_server::stop_stremio_sidecar,
            cast_server::cast_server_stop,
            web_server::web_serve_start,
            web_server::web_serve_stop,
            web_server::web_serve_status,
            web_server::remote_ws_broadcast,
            web_server::remote_ws_client_count,
            web_server::remote_ws_send,
            remote_auth::remote_devices_list,
            remote_auth::remote_device_forget,
            remote_auth::remote_devices_forget_all,
            remote_auth::remote_pair_cancel,
            anime4k::anime4k_download,
            anime4k::anime4k_dir,
            asr_model::asr_ensure_model,
            asr_model::asr_model_path,
            shaders::shader_download,
            shaders::shader_dir,
            svp::svp_status,
            svp::svp_launch,
            svp::svp_ensure_running,
            svp::svp_apply,
            features::profiles::storage::settings_read,
            features::profiles::storage::settings_write,
            features::profiles::storage::secrets_read,
            features::profiles::storage::secrets_write,
            features::profiles::storage::backup_save_safety_copy,
            media_server::media_server_request,
            proc_mem::harbor_process_memory,
            diagnostics::diagnostics_collect,
            diagnostics::diagnostics_cleanup,
            trailer::fetch_trailer,
            temp_prune::temp_usage_bytes,
            temp_prune::temp_clear,
            download::download_start,
            download::download_cancel,
            stream_proxy::proxy_register,
            streams::resolve_playback_redirect,
            stream_proxy::proxy_unregister,
            stream_proxy::proxy_gc_idle,
            cf_relay::cf_list_accounts,
            cf_relay::cf_deploy_relay,
            cf_relay::cf_delete_relay,
            cf_relay::cf_relay_status,
            mpv::mpv_probe,
            mpv::mpv_start,
            mpv::mpv_command,
            mpv::mpv_set_property,
            mpv::mpv_get_property,
            mpv::mpv_audio_devices,
            mpv::mpv_set_geometry,
            mpv::mpv_force_below,
            mpv::mpv_export_log,
            mpv::mpv_set_hdr_stage,
            mpv::display_hdr_active,
            webview_helpers::webview_reapply_transparency,
            mpv::mpv_on_pip_changed,
            mpv::mpv_screenshot_data_url,
            mpv::mpv_save_screenshot,
            mpv::mpv_gif_start,
            mpv::mpv_gif_stop,
            mpv::mpv_gif_abort,
            mpv::mpv_clip_save,
            captions::captions_open,
            captions::captions_close,
            captions::captions_push,
            captions::captions_window_is_open,
            captions::captions_request_state,
            modal_overlay::modal_overlay_open,
            modal_overlay::modal_overlay_close,
            modal_overlay::modal_overlay_emit_result,
            modal_overlay::modal_overlay_emit_state,
            modal_overlay::modal_overlay_emit_action,
            modal_overlay::modal_overlay_sync,
            modal_overlay::modal_overlay_get_pending,
            hdr_overlay::hdr_overlay_open,
            hdr_overlay::hdr_overlay_show,
            hdr_overlay::hdr_overlay_close,
            hdr_overlay::hdr_overlay_hide,
            hdr_overlay::hdr_overlay_sync,
            hdr_overlay::hdr_overlay_emit_props,
            hdr_overlay::hdr_overlay_emit_action,
            mpv::mpv_sub_add,
            mpv::mpv_sub_remove,
            features::subtitles::download::sub_download,
            mpv::mpv_stop,
            mpv::mpv_release_media,
            mpv::mpv_restore_media_surface,
            pip::pip_open,
            pip::pip_get_session,
            pip::pip_close,
            pip::pip_publish_state,
            pip::window_pip_enter,
            pip::window_pip_exit,
            pip_window::pip_window_enter,
            pip_window::pip_window_exit,
            pip_window::pip_window_restore,
            pip_window::pip_window_fit,
            pip_window::pip_window_active,
            fullscreen::window_fullscreen_enter,
            fullscreen::window_fullscreen_exit,
            browser::browser_open,
            browser::browser_close,
            thumbs::thumbs_set_url,
            thumbs::thumbs_spawn_eager,
            thumbs::thumbs_get,
            thumbs::thumbs_stop,
            dvr::dvr_start,
            dvr::dvr_stop,
            dvr::dvr_list,
            dvr::dvr_default_dir,
            dvr::dvr_reveal,
            multiview::multiview_open,
            multiview::multiview_prespawn,
            multiview::multiview_geometry,
            multiview::multiview_audio_focus,
            multiview::multiview_close,
            multiview::multiview_visibility,
            multiview::multiview_stop_all,
            http_fetch::harbor_fetch,
            http_fetch::harbor_upload,
            http_fetch::clear_thumb_cache,
            http_fetch::thumb_cache_size,
            features::subtitles::credentials::subtitle_credential_bind,
            features::subtitles::credentials::subtitle_credentials_clear,
            cf_solver::cf_report,
            capstan::capstan_ping,
            capstan::capstan_install,
            capstan::capstan_uninstall,
            capstan::capstan_extensions,
            capstan::capstan_providers,
            capstan::capstan_search,
            capstan::capstan_load,
            capstan::capstan_load_links,
            capstan::capstan_catalogue,
            capstan::capstan_catalogue_page,
            discord_rp::discord_set_presence,
            discord_rp::discord_clear,
            media_controls::media_controls_update,
            media_controls::media_controls_video_state,
            media_controls::media_controls_progress,
            media_controls::media_controls_seeked,
            media_controls::media_controls_clear,
            gamepad::gamepad_list,
            gamepad::gamepad_set_enabled,
            gamepad::gamepad_set_background_input,
            discord_rp::discord_set_enabled,
            cast::cast_discover,
            harbor_lan::harbor_lan_identity,
            harbor_lan::harbor_lan_advertise,
            harbor_lan::harbor_lan_stop_advertise,
            harbor_lan::harbor_lan_discover,
            dlna::lan_ip,
            cast::cast_load,
            cast::cast_play,
            cast::cast_pause,
            cast::cast_seek,
            cast::cast_stop,
            cast::cast_status,
            cast_server::cast_server_status,
            cast_server::cast_server_restart,
            torrent_engine::torrent_engine_status,
            torrent_engine::torrent_engine_set_enabled,
            torrent_engine::torrent_engine_add,
            torrent_engine::torrent_engine_select,
            torrent_engine::torrent_engine_select_set,
            torrent_engine::torrent_engine_stats,
            torrent_engine::torrent_engine_list,
            torrent_engine::torrent_engine_pause,
            torrent_engine::torrent_engine_resume,
            torrent_engine::torrent_engine_remove,
            torrent_engine::torrent_engine_selftest,
            torrent_engine::torrent_engine_restart,
            torrent_engine::torrent_engine_hard_reset,
            torrent_engine::torrent_engine_set_options,
            transcode::cast_ffmpeg_present,
            streams::streams_run_pipeline,
            streams::streams_parse,
            streams::streams_core_version,
            features::library::scan::harbor_scan_folder,
            tray::tray_set_prefs,
            tray::tray_set_custom_themes,
            stremio_auth::stremio_auth_start,
            mal_auth::mal_auth_start,
            song_id::recognize_now_playing,
            song_id::recognize_now_playing_ai,
            app_icon::set_app_icon,
            launch_args::deeplink_set_stremio,
            launch_args::deeplink_is_stremio_registered,
            launch_args::harbor_take_pending_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                shutdown_services(app_handle);
            }
        });
}
