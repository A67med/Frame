# Contributing to Frame

Thanks for helping improve Frame. Frame is a local-first Windows desktop media app built with Tauri, React, TypeScript, Rust, and libmpv.

## Before you start

- Check [existing issues](https://github.com/A67med/Frame/issues) and [pull requests](https://github.com/A67med/Frame/pulls) to avoid duplicate work.
- For a bug, include the Frame version, Windows version, steps to reproduce, and relevant sanitized logs.
- For a feature, describe the user problem and why it belongs in Frame.

## Development on Windows

1. Install Node.js, pnpm, Rust with the Windows MSVC toolchain, CMake, and Git Bash. Some extension tooling also requires a JDK.
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
   ```
4. For an installer, run `pnpm tauri build --bundles nsis` after provisioning the required native dependencies.

The full architecture and build boundaries are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). See [AGENTS.md](AGENTS.md) for repository-specific development conventions and testing caveats.

## Pull requests

- Work in a focused branch; avoid unrelated refactors or generated artifacts.
- Explain why the change is needed, what you changed, and how you verified it. Attach before/after screenshots for UI changes.
- Keep local media files and private credentials out of commits, screenshots, and issue logs.
- Preserve existing user data, theme files, update signatures, and other compatibility boundaries. Some `harbor.*` keys and identifiers are intentionally retained from the predecessor project; do not rename them just for branding. Review [legacy compatibility notes](docs/LEGACY-COMPATIBILITY.md) first.
- Keep public product copy and issue templates branded **Frame**. Preserve historical credit and third-party notices.
- Releases are managed by the maintainers. Do not manually bump versions or publish a release as part of an ordinary contribution unless specifically requested.

## Security

Please do not report exploitable security vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) for private reporting guidance.

## Project history and licensing

Frame builds independently on work originally released as Harbor. Respect the existing [MIT license](LICENSE), upstream attribution, and third-party notices when contributing.
