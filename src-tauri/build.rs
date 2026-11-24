use std::path::PathBuf;

fn main() {
    let target = std::env::var("TARGET").expect("Cargo target triple");
    assert_eq!(
        target, "x86_64-pc-windows-msvc",
        "Frame requires the Windows x64 MSVC target"
    );
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let libmpv = manifest.join("libmpv");
    if libmpv.join("mpv.lib").exists() {
        println!("cargo:rustc-link-search=native={}", libmpv.display());
        println!(
            "cargo:rerun-if-changed={}",
            libmpv.join("mpv.lib").display()
        );
    }
    if std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default() == "msvc" {
        // Only the app binary gets tauri_build's Common-Controls v6 manifest, so a
        // statically bound comctl32 leaves every cargo test binary unable to start.
        println!("cargo:rustc-link-arg=delayimp.lib");
        println!("cargo:rustc-link-arg=/DELAYLOAD:comctl32.dll");
        // The main thread runs the window event loop, and WebView2 nests that loop
        // while a second window is created. On the default 1 MB reserve that nesting
        // overflowed the stack and took the process down with no panic to catch.
        println!("cargo:rustc-link-arg=/STACK:16777216,1048576");
    }
    if !libmpv.join("libmpv-2.dll").exists() {
        println!("cargo:warning=libmpv-2.dll not found in src-tauri/libmpv. Run `pnpm run setup:libmpv` to fetch it (needed to run and bundle Frame on Windows).");
    }

    tauri_build::build()
}
