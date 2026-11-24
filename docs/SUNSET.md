# Harbor service migration

Frame is a local-first Windows application. The upstream Harbor hosted services closed in October 2026. Existing installations keep their local profiles, libraries, themes and saved playback data. The original Harbor data directory remains available after Frame’s first-launch migration.

## Services in Frame

- Movie and television metadata uses the configured providers. Tracker sign-in goes directly to the selected service. Credentials and account sessions belong to the active profile.
- Compatible Stremio video add-ons run through Frame’s desktop integrations. The Capstan bridge runs locally on Windows.
- Community themes and discovery feeds use static project data. Harbor account sign-in, server-backed theme publishing and its public relay are unavailable.
- The Windows installer and signed updater use Frame’s GitHub Releases. The dependency mirrors for pinned libmpv and FFmpeg resources remain separate from application releases.

See the [product and installation guide](../README.md), [architecture and build guide](ARCHITECTURE.md), [compatibility contracts](LEGACY-COMPATIBILITY.md) and [release procedure](RELEASING.md).
