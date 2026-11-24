# Frame architecture

Frame runs on Windows 10/11 x64. The WebView2 interface renders the library and controls. Rust handles filesystem access, native windows and libmpv. A browser preview is available for interface development. It cannot verify native playback, Windows message handling or the installer.

## From folder to screen

1. The Local tab under `src/features/library/views/library/local-tab/` collects a folder and scan options. Its Rust endpoint, `harbor_scan_folder`, lives in `src-tauri/src/features/library/scan.rs`.
2. The library associates results with titles and episodes. Metadata providers enrich those records when configured. A missing network service must leave a local file playable.
3. Navigation pushes a detail or player frame. The player chooses the local file or a video source and invokes the native playback bridge. React listens for playback and track events so the controls reflect what mpv actually did.
4. Progress and history are associated with the current profile. Changing directories in the source tree does not change the names of saved keys, files or IPC commands.

## Frontend ownership

| Area                                                    | Where to start                                                                                                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and global providers                            | `src/main.tsx`, `src/App.tsx` and `src/app/providers/`                                                                                                                                               |
| Navigation stack, view registry and retained layers     | `src/app/navigation/view.tsx`, `src/app/views.tsx` and `src/app/layer-lifecycle.ts`                                                                                                                  |
| Library, watchlist, collections, profiles and discovery | Corresponding directories under `src/features/`. The Local tab owns scan presentation and progress.                                                                                                  |
| Player and subtitles                                    | `src/views/player.tsx` composes the interface. `src/features/player/engine/` owns playback coordination. `src/features/subtitles/` owns subtitle preparation, selection support and synchronization. |
| Providers and add-ons                                   | `src/features/metadata/`, `src/features/addons/` and service clients under `src/lib/providers/`. The add-on runtime owns its worker and provider compatibility code.                                 |
| Settings and themes                                     | `src/views/settings/` renders panels. Searchable options live in `src/features/settings/search/`. Theme code is under `src/features/themes/` and the existing theme modules in `src/lib/`.           |
| Network and persistence                                 | `src/infrastructure/networking/safe-fetch.ts` selects the HTTP transport. `src/infrastructure/persistence/file-store.ts` connects settings to native file persistence.                               |
| Shared interface                                        | `src/components/`, `src/hooks/` and `src/chrome/` contain shared controls, behavior and window chrome. `src/index.css` includes the selectors custom themes depend on.                               |

Navigation uses Frame’s own stack. Focus, activation and history restoration have distinct behavior. Keep those semantics when opening pages from keyboard, gamepad, file associations or a deep link.

## Native ownership

| Area                 | Implementation                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri lifecycle      | `src-tauri/src/lib.rs` assembles plugins, registers commands and manages process-wide state and shutdown.                                                                                                                                                                         |
| Video engine         | `src-tauri/src/features/playback/mpv.rs` owns the native session and its event handling. Disk cache policy is in `features/playback/cache.rs`.                                                                                                                                    |
| Subtitles            | `features/subtitles/` handles credential lookup, downloading, unpacking and extracting subtitle tracks.                                                                                                                                                                           |
| Library and profiles | `features/library/scan.rs` walks local media. `features/profiles/` owns settings storage and staged migration from the previous application identifier.                                                                                                                           |
| Windows integration  | `platform/windows/webview.rs` provides WebView2-specific commands. `main_window.rs` owns startup, focus and maximize handling. `video_viewport.rs` positions the native child window and restores its geometry. Taskbar, deep links and media controls share this Windows module. |
| Updates              | `features/installer/handoff.rs` and `crates/frame-install-recovery/` coordinate installer handoff and rollback. The NSIS hooks and Tauri configuration define the installer contract.                                                                                             |

Paths beginning with `features/` or `platform/` in this table are relative to `src-tauri/src/`. Tauri command names cross a process boundary. Moving the Rust function must preserve its registered name and argument shape.

## Runtime dependencies

The Windows bundle includes libmpv, mpv, FFmpeg, ffprobe, yt-dlp, fonts and VC runtime files. Setup scripts stage these inputs before packaging. Desktop extension support uses the JVM bridge in `android-extension-compat/` and Capstan. `crates/frame-core/` provides native stream parsing and ranking. The TypeScript pipeline also supports browser-side fallback.

## Validation

Use `pnpm run typecheck` and `pnpm test` for the interface. The Node test loader resolves application aliases and browser imports. Use `cargo check --locked --manifest-path src-tauri/Cargo.toml` and the Cargo test suites for Rust. Put the fetched libmpv DLL on PATH when running the native test executable.

Build the x64 NSIS package and run its bundle verifier before testing installation. Use an isolated Windows account for playback, scanner, persistence and upgrade tests. Check a real audio/video file, alternate tracks, seeking, subtitles and resume after restarting the application. A frontend build alone exercises none of those native paths.

[Windows setup and installer commands](../README.md#development) · [Compatibility contracts](LEGACY-COMPATIBILITY.md) · [Release process](RELEASING.md)
