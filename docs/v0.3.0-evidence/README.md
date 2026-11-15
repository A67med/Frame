# Interface comparison

Actual browser frontend captures, taken on 2026-11-14. Baseline is `271b08ea`;
after captures show the new Default preset. These are not mockups or native
Tauri screenshots. Most captures are 1280×800, using an isolated signed-out
profile with no TMDB key. Catalog images came from live Cinemeta data.

| Screen   | Before                            | After                                | Conditions                                                              |
| -------- | --------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Home     | [Before](before-home.png)         | [After](after-home.png)              | Live feature catalog; empty Continue Watching                           |
| Movie    | [Before](before-movie-detail.png) | [After](after-movie-detail.png)      | Heart of the Beast; baseline includes first-use Play hint               |
| TV       | [Before](before-tv-detail.png)    | [After](after-tv-detail.png)         | MobLand; same title, new dossier exposes episodes sooner                |
| Discover | [Before](before-discover.png)     | [After](after-discover.png)          | Loaded recommendations and still-image action                           |
| Radar    | [Before](before-radar.png)        | [After](after-radar.png)             | Honest no-key state, not a simulated feed                               |
| Library  | [Before](before-library.png)      | [After](after-library-populated.png) | Empty baseline versus one locally bookmarked title after                |
| Search   | [Before](before-search.png)       | [After](after-search-results.png)    | Empty query before; Interstellar query after                            |
| Settings | [Before](before-settings.png)     | [After](after-settings.png)          | Account page; no sign-in performed                                      |
| Player   | [Before](before-player.png)       | [After](after-player.png)            | Generated test-pattern clip, HTML5 engine, paused at about five seconds |

Additional checks:

- [Profile menu](after-profile-menu.png)
- [Sign-in form](after-sign-in.png), no credentials submitted
- [First-run onboarding at 960×600](after-onboarding.png)
- [Missing artwork and a long title](after-missing-artwork.png), explicitly local QA fixture
- [Home at 2560×1440](after-home-2560.png)
- [Home at 960×600](after-home-960.png)
- [Settings at 640×400 effective viewport](after-settings-200.png)

The smaller viewport probes space constraints similar to high display scaling;
it does not establish native Windows per-monitor DPI correctness. Native libmpv,
window controls and configured integrations remain separate review items in the
[verification report](../V0.3.0-VERIFICATION.md).

## Capture method

Vite served the worktree on port 1421 and stable source on port 1422. Playwright
was installed in an external temporary tools directory, leaving project
dependencies unchanged. Chrome used a fresh browser context, reduced-motion
preference and a seeded completed-onboarding flag except for the first-run image.
Navigation used the actual UI and, for isolated player/fixture/theme checks,
the existing React provider actions in the dev build. No production QA hooks were
added. Final image dimensions and contents were inspected after capture.
