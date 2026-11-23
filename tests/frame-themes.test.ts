import "./_localstorage-stub.ts";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { parseHarborStyle } from "../src/lib/harborstyle.ts";
import { loadStoredSettings, sanitizeTheme } from "../src/lib/settings/load.ts";
import { getThemeById, selectableThemes } from "../src/lib/theme.ts";

test("the selector offers the Frame collection and cinematic themes, in order", () => {
  assert.deepEqual(
    selectableThemes().map((t) => t.name),
    ["Default", "Project Hail Mary", "La La Land"],
  );
});

test("a saved theme that is no longer offered falls back to Default", () => {
  for (const preset of [
    "dune",
    "doomsday",
    "zodiac",
    "nord",
    "dracula",
    "elegantfin",
    "stremio",
    "tokyo-night",
    "velvet",
    "amoled",
    "noir-cinema",
    "custom",
    "does-not-exist",
  ]) {
    assert.equal(sanitizeTheme({ preset: preset as never }).preset, "frame", preset);
  }
});

test("all selectable themes survive a settings load", () => {
  for (const { id: preset } of selectableThemes()) {
    assert.equal(sanitizeTheme({ preset: preset as never }).preset, preset);
  }
});

test("an imported theme keeps working without joining the built-in themes", () => {
  assert.equal(sanitizeTheme({ preset: "user:my-theme" }).preset, "user:my-theme");
  assert.equal(
    selectableThemes().some((theme) => theme.id.startsWith("user:")),
    false,
  );
  assert.equal(selectableThemes().length, 3);
});

test("the supplied Project Hail Mary styling matches the distributable built-in", () => {
  const source = readFileSync("data/themes/project-hail-mary.framestyle", "utf8");
  const parsed = parseHarborStyle(source);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const preset = getThemeById("project-hail-mary");
  assert.deepEqual(parsed.theme.tokens, preset?.tokens);
  assert.equal(parsed.theme.layout, preset?.layout);
  assert.equal(parsed.theme.bokeh, preset?.bokeh);
  assert.equal(parsed.theme.fontPair, preset?.fontPair);
  assert.equal(parsed.theme.background, undefined);
  assert.equal(source.includes("data:image"), false);
});

test("Default remains unchanged and all built-ins ship without reference images", () => {
  assert.equal(getThemeById("frame")?.layout, "frame");
  assert.equal(getThemeById("frame")?.tokens["--color-canvas"], "#0c1217");
  for (const preset of selectableThemes()) {
    assert.equal(preset.background, undefined);
    assert.equal(JSON.stringify(preset).includes("backgrounds/"), false);
  }
  for (const id of ["dune", "doomsday", "zodiac"]) assert.equal(getThemeById(id), null);
});

test("missing region defaults to Egypt and an explicit saved region survives", () => {
  for (const [input, expected] of [
    [{}, "EG"],
    [{ region: "US" }, "US"],
    [{ region: "eg" }, "EG"],
    [{ region: "" }, "EG"],
  ] as const) {
    localStorage.setItem("region-test", JSON.stringify(input));
    assert.equal(loadStoredSettings("region-test").region, expected);
  }
});
