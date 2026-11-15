// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function load(file: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, exports);
  return exports;
}

test("imported and alternate themes keep their authored layout without rewriting saved settings", () => {
  for (const [preset, enabled] of [
    ["frame", true],
    ["amoled", true],
    ["custom", false],
    ["user:frame", false],
    ["user:imported-film-journal", false],
    ["tokyo-night", false],
    ["dracula", false],
  ] as const) {
    const theme = Object.freeze({ preset, customColors: null });
    const settings = Object.freeze({ theme });
    const { useCinematicDesktop } = load("lib/use-cinematic-desktop.ts", {
      "./settings": { useSettings: () => ({ settings }) },
      "./profiles": { useActiveKid: () => null },
      "./theme-preview": { useThemePreview: () => null },
    });
    assert.equal(useCinematicDesktop(), enabled, preset);
    assert.equal(settings.theme, theme);
  }
});

test("theme previews and child profiles retain their own interface", () => {
  for (const [kid, preview] of [
    [{ id: "child" }, null],
    [null, { preset: "frame" }],
  ]) {
    const { useCinematicDesktop } = load("lib/use-cinematic-desktop.ts", {
      "./settings": { useSettings: () => ({ settings: { theme: { preset: "frame" } } }) },
      "./profiles": { useActiveKid: () => kid },
      "./theme-preview": { useThemePreview: () => preview },
    });
    assert.equal(useCinematicDesktop(), false);
  }
});

test("history controls follow the existing stack capabilities and delegate navigation", () => {
  const calls: string[] = [];
  const state = {
    canGoBack: false,
    canGoForward: true,
    goBack: () => calls.push("back"),
    goForward: () => calls.push("forward"),
  };
  const { HistoryControls } = load("chrome/history-controls.tsx", {
    "react/jsx-runtime": jsx,
    "lucide-react": { ArrowLeft: "svg", ArrowRight: "svg" },
    "@/lib/i18n": { useT: () => (key: string) => `translated:${key}` },
    "@/lib/view": { useView: () => state },
  });
  const [back, forward] = HistoryControls().props.children;
  assert.equal(back.props.disabled, true);
  assert.equal(forward.props.disabled, false);
  assert.equal(forward.props["aria-label"], "translated:Forward");
  forward.props.onClick();
  state.canGoBack = true;
  state.canGoForward = false;
  const [newBack, newForward] = HistoryControls().props.children;
  assert.equal(newBack.props.disabled, false);
  assert.equal(newForward.props.disabled, true);
  newBack.props.onClick();
  assert.deepEqual(calls, ["forward", "back"]);
});
