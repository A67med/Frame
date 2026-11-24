# Theme Studio and the Frame collection

Frame's redesigned interface is now an explicit `layout: frame` theme property. Default, its Studio preview, saved copies and imported exports all use the navigation rail, command bar and editorial pages. The application version remains 0.3.0 on this feature branch. These changes do not replace the published release.

## What caused the regression

The original `useCinematicDesktop` hook enabled the redesign only for the built-in `frame` and `amoled` IDs, and disabled it whenever a Studio preview existed. Both presets still declared `layout: dracula`. Opening Default in Studio disabled the redesign, and saving a copy created a `user:*` ID that could never enable it.

The hook now resolves the preview's layout or the saved theme's layout. `applyTheme` is shared by previews and saved themes, including visual tokens and color scheme. Closing the editor restores the current saved theme, including a newly saved copy. Preview CSS no longer has a separate palette override that could disagree with the saved result. Theme-specific CSS is suspended while another draft is being previewed. Backgrounds, logos and authored HTML also follow the draft.

## Collection

| Theme         | Visual direction                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Default       | Frame's graphite and amber baseline, editorial serif headings, compact navigation and restrained borders              |
| Noir Cinema   | Charcoal and brass, Sentient display typography, small corners, generous spacing and soft elevation                   |
| Aurora        | Deep blue and violet, luminous mint, geometric typography, rounded navigation, gradient surfaces and restrained glow  |
| Minimal Frost | Cool neutral daylight, sans-serif headings, generous spacing, translucent surfaces and rounded cards                  |
| Editorial     | Warm paper, dark ink and red accents, large Fraunces headlines, square cards and ruled separators                     |
| OLED Black    | True black canvas, mint accents, compact spacing, sans-serif headings and minimal decoration; retains the `amoled` ID |
| Retro Cinema  | Oxblood, cream and amber, expressive serif headings, warmer gradients and substantial rounded panels                  |

Stremio, Royal and Velvet remain selectable with their original layouts. Royal keeps its `tokyo-night` ID. Built-in theme names and descriptions are distinct from user-created names. Supplied artwork and title logos use a dark media surface inside light themes to preserve their legibility.

## Editing

Open Settings → Appearance → Your themes → Customize theme or Open studio.

- **Themes** searches the built-in collection and starts a draft from a preset. Thumbnails are labeled style previews and are generated from the theme's colors and design tokens.
- **Look** edits the identity, palette, visual details, typography and existing card/button styles. The editor has stable dark chrome so a draft's colors do not make its own controls unreadable.
- **Layout** selects Frame or an explicitly preserved legacy layout, then edits navigation order, labels and visibility.
- **Code** retains the existing CSS, HTML and JavaScript tools. JavaScript still runs only through the editor's explicit action during preview.

Reset theme restores the draft as it was when Studio opened. Palette Reset restores Default's official colors. Selecting Default in Themes starts a fresh copy of the official baseline. Undo and redo include reset and preset changes as separate checkpoints. Continuous changes to the same property are grouped without mutating state during React updater replay.

Built-ins save as user themes. Editing a user theme offers Save changes and Save as a new theme. Failed storage leaves the editor open for retry or export. IndexedDB writes wait for transaction completion; fallback local-storage writes never remove the old theme to make quota room.

## Theme format and compatibility

`ThemeDesign` in `src/lib/theme-design.ts` is the shared bounded schema. It controls corner radius, content spacing, heading scale and font role, solid/glass/gradient surfaces, elevation and navigation treatment. `themeDesignTokens` produces the CSS variables used by shared Frame components. Applying any theme replaces the entire visual token set, preventing a previous theme's glow, spacing or corners from leaking into the next.

JSON exports contain an optional `design` object. `.framestyle` exports contain the same object in a `design:` manifest field. Both import paths validate it through the same normalizer. Invalid numbers and unknown enum values resolve to safe defaults. Malformed JSON in the design field is reported as an import error.

Existing saved themes are not rewritten. An old `dracula`, `custom`, `royal` or other layout retains its original layout and code. Themes without new design metadata remain valid. Studio labels legacy layouts and allows an explicit conversion to Frame. Save as a new theme preserves the original. Historic `.harborstyle` files, `user:*` identities, storage keys and CSS hooks remain supported.

Default and OLED Black remain built-in Frame-layout presets in `src/lib/theme.ts`; standalone sample files are no longer distributed at the repository root. Users can export their own `.framestyle` copies from Theme Studio. Previously imported copies remain untouched. Custom fonts are local resources and are not embedded in theme exports.

## Verification

Automated tests cover Default initialization, preset switching, preview/saved parity, visual-token reset, both export formats, persistence, failed writes, legacy preservation and replay-safe undo/redo. `tests/cinematic-desktop.test.ts` also covers child-profile exclusion and preview-layout selection.

The reproducible browser check is `scripts/qa/qa-theme-studio.mjs`. It uses a fresh browser context, exercises actual Studio controls, captures representative pages, and checks 640- and 960-pixel viewports. It also tests file-picker imports and conversion of a legacy theme while preserving the original. With `FRAME_QA_MEDIA` pointing to a local MP4 fixture, it checks HTML5 playback and pause controls for every modern theme.

```powershell
$env:FRAME_QA_PACKAGE = 'C:\path\to\playwright-tools\package.json'
$env:FRAME_QA_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:FRAME_QA_URL = 'http://127.0.0.1:1421'
$env:FRAME_QA_MEDIA = 'C:\path\to\test-pattern.mp4'
node scripts/qa/qa-theme-studio.mjs work/theme-studio/evidence
```

External font failures are recorded in `results.json`. Font pairs retain their system fallbacks. Generated screenshots and detailed local logs live under the ignored `work/theme-studio/` folder. The browser test does not verify native mpv, physical multi-monitor DPI transitions, authenticated provider integrations or installer upgrades.

### Recorded results

- Full Node suite completed with 2,564 passes, one skip and no failures. The subsequent `.framestyle` fixture update passed all seven preset tests.
- TypeScript passed. Vite+ lint passed for 35 changed JavaScript/TypeScript files. Formatting was checked on LF copies using the formatter bundled with Vite+ 1.1.0.
- Settings search passed. The broader settings validator has nine inherited failing categories, identical to the pre-task baseline. The i18n checker completed with its existing nonfatal catalog warnings.
- The Windows NSIS build completed with normal Capstan support. The local `Frame_0.3.0_x64-setup.exe` is 309,088,455 bytes and reports Frame 0.3.0. The installer-script validator confirmed all 14 required resources. Its five Rust warnings and static-runtime deprecation warning match the prior release-build log.
- The compiled production frontend passed the browser matrix for all seven modern themes. Actual Studio controls, reset, undo/redo, export, persistence across reload, editing without duplication, file-picker import and explicit legacy conversion passed. Each theme played and paused the generated HTML5 clip. No page errors or failed font requests were recorded in the successful run.
- Viewports of 640, 960 and 1440 CSS pixels were exercised. This is browser layout coverage, not certification of physical Windows DPI transitions or all accessibility criteria.

Representative screenshots and the machine-readable browser results are in [theme-studio-evidence](theme-studio-evidence/README.md). The local installer is a verification build with the unchanged application version; it has not been published or substituted for the existing v0.3.0 release.
