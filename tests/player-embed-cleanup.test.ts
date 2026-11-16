import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness";

for (const pending of ["import", "move", "resize"] as const) {
  test(`embedded player removes listeners when unmounted during ${pending}`, async () => {
    let finishMove!: (value: () => void) => void;
    let finishResize!: (value: () => void) => void;
    let moved = 0;
    let resized = 0;
    let removedMove = 0;
    let removedResize = 0;
    let closed = 0;
    const hook = hookHarness("src/views/player/hooks/use-mpv-embed.ts", "useMpvEmbed", {
      "@/lib/platform": { isLinuxDesktop: () => false, isMacDesktop: () => false },
      "@/lib/modal-overlay": {
        modalOverlaySync: () => {},
        modalOverlayClose: () => {
          closed += 1;
        },
      },
      "@tauri-apps/api/window": {
        getCurrentWindow: () => ({
          onMoved: () => {
            moved += 1;
            return new Promise((resolve) => {
              finishMove = resolve;
            });
          },
          onResized: () => {
            resized += 1;
            return new Promise((resolve) => {
              finishResize = resolve;
            });
          },
        }),
      },
    });
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    hook.render({ engine: "mpv", settings: { playerMpvEmbed: true } });
    if (pending !== "import") await flush();
    if (pending === "resize") {
      finishMove(() => {
        removedMove += 1;
      });
      await flush();
    }
    hook.unmount();
    if (pending === "move")
      finishMove(() => {
        removedMove += 1;
      });
    if (pending === "resize")
      finishResize(() => {
        removedResize += 1;
      });
    await flush();
    assert.equal(closed, 1);
    assert.equal(moved, pending === "import" ? 0 : 1);
    assert.equal(removedMove, moved);
    assert.equal(resized, pending === "resize" ? 1 : 0);
    assert.equal(removedResize, resized);
  });
}
