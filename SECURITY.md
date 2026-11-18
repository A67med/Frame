# Security Policy

Frame is a community-maintained Windows desktop media application. We take reports involving app security, updater authenticity, local media and settings, external integrations, and bundled native dependencies seriously.

## Supported releases

Security fixes are considered for the **latest stable Windows 10/11 x64 release**. Older releases, experimental builds, and macOS/Linux packages are not currently supported targets. This is not a guarantee of a remediation timeline.

## Reporting a vulnerability

**Please do not post exploit details, credentials, user data, or proof-of-concept payloads in a public GitHub Issue.**

1. Visit the repository's [Security tab](https://github.com/A67med/Frame/security) and use **Report a vulnerability** if private vulnerability reporting is available.
2. Include the affected Frame version, Windows version, affected feature, reproducible steps, potential impact, and a minimal sanitized proof of concept.
3. If private vulnerability reporting is unavailable, open a public issue **only to ask maintainers for a private reporting channel**; do not disclose the vulnerability itself.

Maintainers will triage reports according to severity and available capacity. Please allow time for a coordinated fix before public disclosure.

## Update integrity

Frame's Tauri updater uses signed update metadata/artifacts. This is distinct from Microsoft Authenticode code-signing of the Windows installer. Installers should be downloaded from the [official GitHub Releases](https://github.com/A67med/Frame/releases) and checked against published hashes where available. Never share updater private keys or committed secrets.
