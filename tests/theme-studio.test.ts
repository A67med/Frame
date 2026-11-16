import {
  updateDraftHistory,
  stepDraftHistory,
  type DraftHistory,
} from "../src/views/settings/theme-panel/theme-studio/draft-history.ts";
import "./_localstorage-stub.ts";
// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import {
  activeLayout,
  applyTheme,
  DEFAULT_THEME,
  getThemeById,
  selectableThemes,
} from "../src/lib/theme.ts";
import {
  exportThemeJson,
  getCustomThemes,
  parseThemeJson,
  saveCustomTheme,
  persistCustomTheme,
} from "../src/lib/custom-themes.ts";
import { parseHarborStyle, serializeHarborStyle } from "../src/lib/harborstyle.ts";
import { DEFAULT_THEME_DESIGN, normalizeThemeDesign } from "../src/lib/theme-design.ts";
import { emptyDraft } from "../src/views/settings/theme-panel/theme-studio/studio-draft.ts";

test("Default and a blank Studio draft both resolve to the canonical Frame layout", () => {
  assert.equal(activeLayout(DEFAULT_THEME), "frame");
  assert.equal(emptyDraft().layout, "frame");
  assert.equal(emptyDraft(getThemeById("frame")!).layout, "frame");
  assert.deepEqual(emptyDraft().design, DEFAULT_THEME_DESIGN);
});

test("every modern preset survives both file formats, save and settings resolution", () => {
  for (const preset of selectableThemes().filter((p) => p.layout === "frame")) {
    for (const result of [
      parseThemeJson(exportThemeJson(preset)),
      parseHarborStyle(serializeHarborStyle(preset)),
    ]) {
      assert.ok(result.ok);
      if (!result.ok) continue;
      assert.equal(result.theme.layout, "frame");
      assert.deepEqual(result.theme.tokens, preset.tokens);
      assert.deepEqual(
        normalizeThemeDesign(result.theme.design),
        normalizeThemeDesign(preset.design),
      );
      assert.ok(saveCustomTheme(result.theme));
      assert.equal(activeLayout({ ...DEFAULT_THEME, preset: result.theme.id as never }), "frame");
    }
  }
});

test("legacy layouts and authored code survive import and editing without automatic conversion", () => {
  const legacy = {
    ...getThemeById("frame")!,
    layout: "dracula",
    css: ".harbor-poster { border-radius: 11px; }",
    design: undefined,
  };
  const result = parseThemeJson(JSON.stringify(legacy));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.theme.layout, "dracula");
  assert.equal(emptyDraft(result.theme as never).layout, "dracula");
  assert.equal(emptyDraft(result.theme as never).css, legacy.css);
  assert.equal(result.theme.design, undefined);
});

test("visual values are bounded and unknown input cannot become arbitrary CSS", () => {
  assert.deepEqual(normalizeThemeDesign(null), DEFAULT_THEME_DESIGN);
  const d = normalizeThemeDesign({
    radius: 500,
    density: -1,
    headingScale: NaN,
    surface: "url(https://invalid)",
    elevation: "bad",
  });
  assert.equal(d.radius, 24);
  assert.equal(d.density, 0.8);
  assert.equal(d.headingScale, 1);
  assert.equal(d.surface, "solid");
  assert.equal(d.elevation, "none");
});

test("saving an existing theme updates its identity without adding a duplicate", () => {
  const result = parseThemeJson(exportThemeJson(getThemeById("frame")!));
  assert.ok(result.ok);
  if (!result.ok) return;
  saveCustomTheme(result.theme);
  const count = getCustomThemes().length;
  saveCustomTheme({ ...result.theme, name: "Edited theme" });
  assert.equal(getCustomThemes().length, count);
  assert.equal(getThemeById(result.theme.id)?.name, "Edited theme");
});

test("preview and saved themes apply identically and switching back clears visual tokens", () => {
  const properties = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: { setProperty: (k: string, v: string) => properties.set(k, v), colorScheme: "" },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: root },
  });
  try {
    const preset = getThemeById("aurora-frame")!;
    applyTheme(DEFAULT_THEME, preset);
    const preview = [...properties.entries()];
    const result = parseThemeJson(exportThemeJson(preset));
    assert.ok(result.ok);
    if (!result.ok) return;
    saveCustomTheme(result.theme);
    applyTheme({ ...DEFAULT_THEME, preset: result.theme.id as never });
    assert.deepEqual([...properties.entries()], preview);
    assert.equal(root.dataset.themeLayout, "frame");
    applyTheme(DEFAULT_THEME);
    assert.equal(properties.get("--frame-radius"), "8px");
    assert.equal(properties.get("--frame-elevation"), "none");
    assert.equal(properties.get("--frame-blur"), "none");
    assert.equal(properties.get("--color-canvas"), getThemeById("frame")!.tokens["--color-canvas"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("undo transitions are repeatable under React replay and reset has its own checkpoint", () => {
  const draft = emptyDraft();
  const initial: DraftHistory = { draft, past: [], future: [], lastPushAt: 0, group: null };
  const edited = { ...draft, design: { ...draft.design, radius: 20 } };
  const first = updateDraftHistory(initial, edited, 1000, "design");
  assert.deepEqual(updateDraftHistory(initial, edited, 1000, "design"), first);
  assert.deepEqual(initial.past, []);
  const reset = updateDraftHistory(first, draft, 1100, null);
  const undone = stepDraftHistory(reset, "undo");
  assert.equal(undone.draft.design.radius, 20);
  assert.equal(stepDraftHistory(undone, "redo").draft.design.radius, 8);
  const afterUndo = updateDraftHistory(undone, { ...edited, name: "Changed" }, 1200, "name");
  assert.equal(afterUndo.future.length, 0);
  const moved = updateDraftHistory(
    first,
    { ...edited, design: { ...edited.design, radius: 21 } },
    1050,
    "design",
  );
  assert.equal(moved.past.length, 1);
});

test("failed durable saves leave the existing library unchanged", async () => {
  const result = parseThemeJson(exportThemeJson(getThemeById("frame")!));
  assert.ok(result.ok);
  if (!result.ok) return;
  result.theme.id = "user:persistence-check";
  assert.equal(await persistCustomTheme(result.theme), true);
  const before = getCustomThemes();
  const storedBefore = localStorage.getItem("harbor.custom-themes.v1");
  const original = localStorage.setItem;
  try {
    localStorage.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
    assert.equal(await persistCustomTheme({ ...result.theme, name: "Unsaved edit" }), false);
    assert.equal(getCustomThemes(), before);
    assert.equal(localStorage.getItem("harbor.custom-themes.v1"), storedBefore);
  } finally {
    localStorage.setItem = original;
  }
});
