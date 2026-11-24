# Source and dependency ownership

Frame targets Windows x64. Keep a component according to its runtime consumers, installation requirements and compatibility obligations.

| Keep                                             | Reason                                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `android-extension-compat/` and Capstan staging  | Compatible video extensions execute through this bridge on the Windows desktop.                                                          |
| libmpv, FFmpeg and supporting runtime resources  | The native engine and sidecars provide playback, probing and extraction. Their filenames are packaging inputs.                           |
| Vendored `librqbit` and `rust_cast`              | Native media networking and casting use the checked-in crates. Verify local patches and license terms before changing their source.      |
| Profile avatars, theme selectors and legacy keys | Existing profiles and external themes refer to these by identifier. An unused static import does not prove that an asset can be removed. |
| Upstream licenses and notices                    | Attribution follows the originating code and bundled dependencies.                                                                       |
| Browser test support and gamepad input           | They support interface development and desktop navigation.                                                                               |

The library scanner, profile storage, installer handoff and subtitle operations now have native feature owners. The video extension runtime owns its worker and DOM/crypto helpers independently of the former reader modules. Separate storage contracts from product code when making removals. Historical user records can stay in place after their original interface is retired.

Check dependency changes against the pnpm and Cargo lockfiles, dynamic asset lookups, Tauri capabilities, NSIS hooks and the bundle verifier. Confirm the user's profile can still open its local media and themes before publishing an upgrade.

[Architecture](ARCHITECTURE.md) · [Compatibility](LEGACY-COMPATIBILITY.md)
