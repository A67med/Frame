import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createCatalogCache } from "../src/lib/providers/tmdb/tmdb-catalog-cache.ts";

function harness(get = async () => null) {
  const output = ts.transpileModule(readFileSync("src/lib/radar/digital-releases.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = {};
  new Function("require", "exports", output)(
    (id) =>
      id.endsWith("tmdb-client")
        ? { get, effectiveTmdbLanguage: () => "en" }
        : id.endsWith("tmdb-catalog-cache")
          ? { createCatalogCache }
          : { movieMeta: (m) => ({ id: `tmdb:${m.id}`, name: m.title }) },
    module,
  );
  return module;
}
const { validDigitalDay, digitalReleaseDay } = harness();
const dates = (records, region = "US") => ({
  results: [{ iso_3166_1: region, release_dates: records }],
});
const digital = (day) => ({ type: 4, release_date: `${day}T00:00:00.000Z` });

test("digital dates reject invalid calendar days and retain source day", () => {
  for (const value of [
    null,
    {},
    "",
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "not a date",
    "2026-11-01Tgarbage",
  ])
    assert.equal(validDigitalDay(value), null);
  assert.equal(validDigitalDay("2024-02-29T00:00:00.000Z"), "2024-02-29");
});

test("only in-window type 4 records in the explicit region are accepted", () => {
  const source = dates([
    { type: 3, release_date: "2026-11-01" },
    { type: 5, release_date: "2026-11-02" },
    digital("2026-10-30"),
    digital("2026-11-20"),
    digital("2026-11-05"),
    digital("2026-11-05"),
  ]);
  assert.equal(digitalReleaseDay(source, "US", "2026-11-01", "2026-11-30"), "2026-11-05");
  assert.equal(digitalReleaseDay(source, "EG", "2026-11-01", "2026-11-30"), null);
  assert.equal(digitalReleaseDay(dates([]), "US", "2026-11-01", "2026-11-30"), null);
  assert.throws(() => digitalReleaseDay({}, "US", "2026-11-01", "2026-11-30"));
});

test("calendar reads every page, deduplicates before details, sorts verified dates", async () => {
  const calls = [];
  const h = harness(async (_key, path, params) => {
    calls.push({ path, params });
    if (path === "discover/movie")
      return {
        total_pages: 2,
        results:
          params.page === "1"
            ? [
                { id: 1, title: "First" },
                { id: 2, title: "Second" },
              ]
            : [
                { id: 1, title: "First" },
                { id: 3, title: "Missing region" },
              ],
      };
    return path === "movie/3/release_dates"
      ? dates([digital("2026-11-01")], "GB")
      : dates([digital(path.includes("/1/") ? "2026-11-20" : "2026-11-03")]);
  });
  const items = await h.fetchDigitalReleases("synthetic-key", "US", "2026-11-01", "2026-11-30");
  assert.deepEqual(
    items.map((m) => [m.id, m.radarDate]),
    [
      ["tmdb:2", "2026-11-03"],
      ["tmdb:1", "2026-11-20"],
    ],
  );
  await h.fetchDigitalReleases("synthetic-key", "US", "2026-11-01", "2026-11-30");
  assert.equal(calls.length, 5, "reopening a calendar reuses the verified result");
  assert.equal(calls[0].params.with_release_type, "4");
  assert.equal(calls[0].params.region, "US");
  assert.equal(calls[0].params["release_date.gte"], "2026-11-01");
  assert.equal(calls[0].params["primary_release_date.gte"], undefined);
});

test("empty past and future windows are valid, unavailable pages are not empty success", async () => {
  for (const month of ["2025-01", "2027-01"]) {
    assert.deepEqual(
      await harness(async () => ({ results: [], total_pages: 0 })).fetchDigitalReleases(
        "key",
        "US",
        `${month}-01`,
        `${month}-31`,
      ),
      [],
    );
  }
  for (const response of [
    null,
    {},
    { results: {}, total_pages: 1 },
    { results: [], total_pages: 501 },
    { results: [], total_pages: -1 },
  ]) {
    await assert.rejects(
      harness(async () => response).fetchDigitalReleases("key", "US", "2026-11-01", "2026-11-30"),
    );
  }
  await assert.rejects(
    harness().fetchDigitalReleases("", "US", "2026-11-01", "2026-11-30"),
    /missing-tmdb-key/,
  );
  await assert.rejects(
    harness().fetchDigitalReleases("key", "", "2026-11-01", "2026-11-30"),
    /invalid-release-window/,
  );
});

test("failed detail retrieval does not silently drop a possible digital release", async () => {
  await assert.rejects(
    harness(async (_key, path) =>
      path === "discover/movie" ? { results: [{ id: 1, title: "Test" }], total_pages: 1 } : null,
    ).fetchDigitalReleases("key", "US", "2026-11-01", "2026-11-30"),
    /unavailable/,
  );
});
