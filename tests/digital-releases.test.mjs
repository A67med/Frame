import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createCatalogCache } from "../src/lib/providers/tmdb/tmdb-catalog-cache.ts";

const people = [
  { id: 10, name: "Actor", role: "acting" },
  { id: 20, name: "Director", role: "directing" },
];
const credits = [1, 2, 3].map((id) => ({
  tmdbId: id,
  mediaType: "movie",
  people: people.map((p) => ({ ...p, profile: null })),
}));
function harness(get = async () => null, loadFollowCredits = async () => ({ credits, failed: 0 })) {
  const output = ts.transpileModule(readFileSync("src/lib/radar/digital-releases.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = {};
  new Function("require", "exports", output)(
    (id) =>
      id.endsWith("follow-credits")
        ? { loadFollowCredits }
        : id.endsWith("tmdb-client")
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
  assert.equal(digitalReleaseDay(source, "EG", "2026-11-01", "2026-11-30", people), null);
  assert.equal(digitalReleaseDay(dates([]), "US", "2026-11-01", "2026-11-30", people), null);
  assert.throws(() => digitalReleaseDay({}, "US", "2026-11-01", "2026-11-30", people));
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
  const items = await h.fetchDigitalReleases(
    "synthetic-key",
    "US",
    "2026-11-01",
    "2026-11-30",
    people,
  );
  assert.deepEqual(
    items.map((m) => [m.id, m.radarDate]),
    [
      ["tmdb:2", "2026-11-03"],
      ["tmdb:1", "2026-11-20"],
    ],
  );
  await h.fetchDigitalReleases("synthetic-key", "US", "2026-11-01", "2026-11-30", people);
  assert.equal(calls.length, 5, "reopening a calendar reuses the verified result");
  assert.equal(calls[0].params.with_people, "10|20");
  assert.equal(items[0].people.length, 2);
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
        people,
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
      harness(async () => response).fetchDigitalReleases(
        "key",
        "US",
        "2026-11-01",
        "2026-11-30",
        people,
      ),
    );
  }
  await assert.rejects(
    harness().fetchDigitalReleases("", "US", "2026-11-01", "2026-11-30", people),
    /missing-tmdb-key/,
  );
  await assert.rejects(
    harness().fetchDigitalReleases("key", "", "2026-11-01", "2026-11-30", people),
    /invalid-release-window/,
  );
});

test("failed detail retrieval does not silently drop a possible digital release", async () => {
  await assert.rejects(
    harness(async (_key, path) =>
      path === "discover/movie" ? { results: [{ id: 1, title: "Test" }], total_pages: 1 } : null,
    ).fetchDigitalReleases("key", "US", "2026-11-01", "2026-11-30", people),
    /unavailable/,
  );
});

test("empty Following performs no network requests and never substitutes popular movies", async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    throw new Error("unexpected");
  });
  assert.deepEqual(await h.fetchDigitalReleases("key", "EG", "2026-11-01", "2026-11-30", []), []);
  assert.equal(calls, 0);
});

test("role-mismatched movies are filtered before requesting dates", async () => {
  const calls = [];
  const h = harness(async (_key, path) => {
    calls.push(path);
    return { results: [{ id: 99, title: "Wrong role" }], total_pages: 1 };
  });
  assert.deepEqual(
    await h.fetchDigitalReleases("key", "EG", "2026-11-01", "2026-11-30", people),
    [],
  );
  assert.deepEqual(calls, ["discover/movie"]);
});

test("failed Following lookup is an error, not an empty calendar", async () => {
  const h = harness(
    async () => ({ results: [], total_pages: 0 }),
    async () => ({ credits: [], failed: 1 }),
  );
  await assert.rejects(
    h.fetchDigitalReleases("key", "EG", "2026-11-01", "2026-11-30", people),
    /following-unavailable/,
  );
});

test("a cancelled selection stops queued work before discovery", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    harness().fetchDigitalReleases(
      "key",
      "EG",
      "2026-11-01",
      "2026-11-30",
      people,
      controller.signal,
    ),
    { name: "AbortError" },
  );
});

test("region and Following changes cannot reuse another calendar's attribution", async () => {
  let requests = 0;
  const h = harness(async (_key, path) => {
    requests++;
    if (path === "discover/movie") return { results: [{ id: 1, title: "Movie" }], total_pages: 1 };
    return dates([digital("2026-11-04")], "US");
  });
  assert.equal(
    (await h.fetchDigitalReleases("key", "US", "2026-11-01", "2026-11-30", people)).length,
    1,
  );
  assert.equal(
    (await h.fetchDigitalReleases("key", "EG", "2026-11-01", "2026-11-30", people)).length,
    0,
  );
  assert.equal(requests, 4);
});

// The hidden region control must never leave an old global preference driving Radar.
test("Radar digital releases stay in Egypt without a region selector", () => {
  const source = readFileSync("src/views/radar.tsx", "utf8");
  const section = source.slice(
    source.indexOf("function DigitalReleasesSection("),
    source.indexOf("export default"),
  );
  assert.match(section, /const region = "EG"/);
  assert.doesNotMatch(section, /RegionPicker|settings\.region|update\(\{ region/);
  assert.match(section, /region: t\("Egypt"\)/);
});
