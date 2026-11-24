#[cfg(windows)]
mod win {
    use std::sync::mpsc::{channel, Sender};
    use std::sync::OnceLock;
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };

    static TX: OnceLock<Sender<bool>> = OnceLock::new();

    fn sender() -> &'static Sender<bool> {
        TX.get_or_init(|| {
            let (tx, rx) = channel::<bool>();
            std::thread::Builder::new()
                .name("harbor-power".into())
                .spawn(move || {
                    let mut held = false;
                    while let Ok(on) = rx.recv() {
                        if on == held {
                            continue;
                        }
                        let flags = if on {
                            ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
                        } else {
                            ES_CONTINUOUS
                        };
                        unsafe { SetThreadExecutionState(flags) };
                        held = on;
                    }
                    unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
                })
                .ok();
            tx
        })
    }

    pub fn set(on: bool) {
        let _ = sender().send(on);
    }
}

#[tauri::command]
pub async fn power_inhibit(on: bool) {
    #[cfg(windows)]
    {
        win::set(on);
    }
}
