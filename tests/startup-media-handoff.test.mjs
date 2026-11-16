import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/App.tsx", "utf8");
const end =
  source.indexOf("}, [setView, openMeta, openPlayer, openPerson]);") +
  "}, [setView, openMeta, openPlayer, openPerson]);".length;
const start = source.lastIndexOf("  useEffect(() => {", end);
const effect = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const earlyUnmount of [false, true]) {
  test(`startup media subscribes before delivery; early unmount=${earlyUnmount}`, async () => {
    let cleanup;
    let fileHandler;
    let resolveBridge;
    let stopped = 0;
    let removed = 0;
    const players = [];
    const noop = () => {};
    const bridge = {
      onOpenLocalFile: (handler) => {
        fileHandler = handler;
        return () => {
          removed += 1;
        };
      },
      onDeepLinkInstall: () => () => {
        removed += 1;
      },
      onDeepLinkOpen: () => () => {
        removed += 1;
      },
      startDeepLinkBridge: () => {
        assert.equal(typeof fileHandler, "function");
        fileHandler("C:\\fixtures\\test.mp4");
        return new Promise((resolve) => {
          resolveBridge = resolve;
        });
      },
    };
    new Function("require", "useEffect", "setView", "openMeta", "openPlayer", "openPerson", effect)(
      () => bridge,
      (run) => {
        cleanup = run();
      },
      noop,
      noop,
      (p) => players.push(p),
      noop,
    );
    if (earlyUnmount) cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (earlyUnmount) {
      assert.equal(players.length, 0);
      assert.equal(resolveBridge, undefined);
    } else {
      assert.equal(players[0].url, "C:\\fixtures\\test.mp4");
      assert.equal(players[0].title, "test");
      cleanup();
      resolveBridge(() => {
        stopped += 1;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(removed, 3);
      assert.equal(stopped, 1);
    }
  });
}
