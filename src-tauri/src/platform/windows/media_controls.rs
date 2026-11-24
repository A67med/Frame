#[cfg(windows)]
mod win {
    use std::sync::{Mutex, OnceLock};
    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::HSTRING;
    use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
        SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    };
    use windows::Storage::Streams::RandomAccessStreamReference;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

    struct Holder(SystemMediaTransportControls);
    unsafe impl Send for Holder {}
    unsafe impl Sync for Holder {}

    static SMTC: OnceLock<Option<Holder>> = OnceLock::new();
    static LAST_PUSHED: OnceLock<Mutex<Option<(bool, String, String, String)>>> = OnceLock::new();

    fn controls() -> Option<&'static SystemMediaTransportControls> {
        SMTC.get().and_then(|h| h.as_ref()).map(|h| &h.0)
    }

    pub fn init(app: &AppHandle) {
        let created = SMTC.get_or_init(|| match build(app) {
            Ok(smtc) => Some(Holder(smtc)),
            Err(e) => {
                eprintln!("[harbor::media] SMTC init failed: {e:?}");
                None
            }
        });
        if created.is_some() {
            eprintln!("[harbor::media] SMTC session registered");
        }
    }

    fn build(app: &AppHandle) -> windows::core::Result<SystemMediaTransportControls> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(windows::core::Error::empty)?;
        let raw = window.hwnd().map_err(|_| windows::core::Error::empty())?;
        let hwnd = HWND(raw.0 as *mut _);
        let interop = windows::core::factory::<
            SystemMediaTransportControls,
            ISystemMediaTransportControlsInterop,
        >()?;
        let smtc: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd)? };
        smtc.SetIsPlayEnabled(true)?;
        smtc.SetIsPauseEnabled(true)?;
        smtc.SetIsNextEnabled(true)?;
        smtc.SetIsPreviousEnabled(true)?;
        smtc.SetIsStopEnabled(true)?;
        smtc.SetIsEnabled(false)?;
        let handle = app.clone();
        smtc.ButtonPressed(&TypedEventHandler::new(
            move |_,
                  args: windows::core::Ref<
                '_,
                SystemMediaTransportControlsButtonPressedEventArgs,
            >| {
                if let Some(a) = args.as_ref() {
                    let name = match a.Button()? {
                        SystemMediaTransportControlsButton::Play => "play",
                        SystemMediaTransportControlsButton::Pause => "pause",
                        SystemMediaTransportControlsButton::Next => "next",
                        SystemMediaTransportControlsButton::Previous => "previous",
                        SystemMediaTransportControlsButton::Stop => "stop",
                        _ => return Ok(()),
                    };
                    let _ = handle.emit("harbor://media-key", name);
                }
                Ok(())
            },
        ))?;
        let seek_handle = app.clone();
        smtc.PlaybackPositionChangeRequested(&TypedEventHandler::new(
            move |_, args: windows::core::Ref<'_, PlaybackPositionChangeRequestedEventArgs>| {
                if let Some(a) = args.as_ref() {
                    let ticks = a.RequestedPlaybackPosition()?.Duration;
                    let _ = seek_handle.emit("harbor://media-seek-absolute", ticks as f64 / 1e7);
                }
                Ok(())
            },
        ))?;
        Ok(smtc)
    }

    fn span(sec: f64) -> TimeSpan {
        TimeSpan {
            Duration: (sec.max(0.0) * 1e7) as i64,
        }
    }

    fn push_timeline(smtc: &SystemMediaTransportControls, duration: f64, position: f64) {
        let result = (|| -> windows::core::Result<()> {
            let tl = SystemMediaTransportControlsTimelineProperties::new()?;
            tl.SetStartTime(span(0.0))?;
            tl.SetMinSeekTime(span(0.0))?;
            tl.SetEndTime(span(duration))?;
            tl.SetMaxSeekTime(span(duration))?;
            tl.SetPosition(span(position.min(duration)))?;
            smtc.UpdateTimelineProperties(&tl)
        })();
        if let Err(e) = result {
            eprintln!("[harbor::media] SMTC timeline update failed: {e:?}");
        }
    }

    fn sanitize(s: &str) -> String {
        s.trim()
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .take(256)
            .collect()
    }

    pub fn update(
        playing: bool,
        title: &str,
        subtitle: &str,
        art_url: Option<&str>,
        duration_sec: Option<f64>,
        position_sec: Option<f64>,
    ) {
        let title = sanitize(title);
        let subtitle = sanitize(subtitle);
        let art = art_url
            .filter(|u| u.starts_with("https://"))
            .unwrap_or_default()
            .to_string();

        let Some(smtc) = controls() else { return };

        if let Some(duration) = duration_sec.filter(|d| d.is_finite() && *d > 0.0) {
            let position = position_sec.filter(|p| p.is_finite()).unwrap_or(0.0);
            push_timeline(smtc, duration, position);
        }

        let last = LAST_PUSHED.get_or_init(|| Mutex::new(None));
        let mut guard = last.lock().unwrap_or_else(|error| error.into_inner());
        let next = (playing, title, subtitle, art);
        if guard.as_ref() == Some(&next) {
            return;
        }
        let result = (|| -> windows::core::Result<()> {
            smtc.SetIsEnabled(true)?;
            smtc.SetPlaybackStatus(if playing {
                MediaPlaybackStatus::Playing
            } else {
                MediaPlaybackStatus::Paused
            })?;
            let du = smtc.DisplayUpdater()?;
            du.SetType(MediaPlaybackType::Video)?;
            let vp = du.VideoProperties()?;
            vp.SetTitle(&HSTRING::from(next.1.as_str()))?;
            vp.SetSubtitle(&HSTRING::from(next.2.as_str()))?;
            if next.3.is_empty() {
                du.SetThumbnail(None)?;
            } else {
                let uri = Uri::CreateUri(&HSTRING::from(next.3.as_str()))?;
                du.SetThumbnail(&RandomAccessStreamReference::CreateFromUri(&uri)?)?;
            }
            du.Update()
        })();
        // Failed pushes must remain retryable on the next update.
        *guard = result.ok().map(|_| next);
    }

    pub fn clear() {
        let Some(smtc) = controls() else { return };
        let last = LAST_PUSHED.get_or_init(|| Mutex::new(None));
        let mut guard = last.lock().unwrap_or_else(|error| error.into_inner());
        // Refocusing or replaying the same title must enable the session again.
        *guard = None;
        let _ = smtc.SetPlaybackStatus(MediaPlaybackStatus::Closed);
        if let Ok(du) = smtc.DisplayUpdater() {
            let _ = du.ClearAll();
            let _ = du.Update();
        }
        let _ = smtc.SetIsEnabled(false);
    }
}

pub fn ensure_started_on_setup(app: &tauri::AppHandle) {
    #[cfg(windows)]
    win::init(app);
}

#[tauri::command]
pub fn media_controls_update(
    playing: bool,
    title: String,
    subtitle: String,
    art_url: Option<String>,
    duration_sec: Option<f64>,
    position_sec: Option<f64>,
    volume: Option<f64>,
) {
    #[cfg(windows)]
    win::update(
        playing,
        &title,
        &subtitle,
        art_url.as_deref(),
        duration_sec,
        position_sec,
    );
    #[cfg(windows)]
    let _ = volume;
}

#[tauri::command]
pub fn media_controls_video_state(
    active: bool,
    playing: bool,
    muted: bool,
    has_prev: bool,
    has_next: bool,
) {
    #[cfg(windows)]
    crate::platform::windows::taskbar::set_video(active, playing, muted, has_prev, has_next);
}

#[tauri::command]
pub fn media_controls_progress(fraction: Option<f64>, playing: bool) {
    #[cfg(windows)]
    crate::platform::windows::taskbar::set_progress(fraction, playing);
}

#[tauri::command]
pub fn media_controls_seeked(position_sec: f64) {
    let _ = position_sec;
}

#[tauri::command]
pub fn media_controls_clear() {
    #[cfg(windows)]
    win::clear();
}
