# Contributing to Frame

Thanks for helping improve Frame. Frame is a local-first Windows desktop media app built with Tauri, React, TypeScript, Rust, and libmpv.

## Before you start

- Check [existing issues](https://github.com/A67med/Frame/issues) and [pull requests](https://github.com/A67med/Frame/pulls) to avoid duplicate work.
- For a bug, include the Frame version, Windows version, steps to reproduce, and relevant sanitized logs.
- For a feature, describe the user problem and why it belongs in Frame.

## Development on Windows

1. Install Node.js, pnpm, Rust for x86_64-pc-windows-msvc, Visual Studio C++ Build Tools with the x64 compiler and Windows SDK, CMake, Git Bash and a JDK 17 or newer with jmods for Capstan.
2. Clone the repository and run:
   ```sh
   pnpm install
   pnpm run setup
   pnpm tauri dev
   ```
3. Run checks relevant to your changes:
   ```sh
   pnpm run typecheck
   pnpm test
   cargo fmt --manifest-path src-tauri/Cargo.toml --check
   cargo check --locked --manifest-path src-tauri/Cargo.toml
   cargo test --locked --manifest-path src-tauri/Cargo.toml
   ```
4. For an installer, run `pnpm tauri build --bundles nsis` and verify its staged files with `node scripts/verify-windows-bundle.mjs --require-capstan`. On Windows the native tests need `src-tauri/libmpv` on PATH.

The full architecture and build boundaries are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Pull requests

- Work in a focused branch; avoid unrelated refactors or generated artifacts.
- Explain why the change is needed, what you changed, and how you verified it. Attach before/after screenshots for UI changes.
- Keep local media files and private credentials out of commits, screenshots, and issue logs.
- Preserve existing user data, theme files, update signatures, and other compatibility boundaries. Some `harbor.*` keys and identifiers are intentionally retained from the predecessor project; do not rename them just for branding. Review [legacy compatibility notes](docs/LEGACY-COMPATIBILITY.md) first.
- Keep public product copy and issue templates branded **Frame**. Preserve historical credit and third-party notices.
- Releases are managed through reviewed version-bump pull requests. Do not bump versions or publish releases in ordinary feature/bug-fix contributions. Maintainers follow [the release guide](docs/RELEASING.md).

## Security

Please do not report exploitable security vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) for private reporting guidance.

## Project history and licensing

Frame builds independently on work originally released as Harbor. Respect the existing [MIT license](LICENSE), upstream attribution, and third-party notices when contributing.
