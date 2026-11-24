import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createRequestScheduler } from "../src/lib/request-scheduler.ts";
import { createCatalogCache, isCatalogPath } from "../src/lib/providers/tmdb/tmdb-catalog-cache.ts";

test("release-date requests recover from rate limiting and cache only successful data", async () => {
  let calls = 0;
  const source = ts.transpileModule(readFileSync("src/lib/providers/tmdb/tmdb-client.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const api = {};
  const dependencies = {
    "@/infrastructure/networking/safe-fetch": {
      safeFetch: async () => {
        calls += 1;
        return calls < 3
          ? new Response("{}", { status: 429 })
          : Response.json({ results: [{ iso_3166_1: "US", release_dates: [] }] });
      },
    },
    "@/lib/request-scheduler": { createRequestScheduler },
    "./tmdb-catalog-cache": { createCatalogCache, isCatalogPath },
  };
  new Function("require", "exports", source)((name) => dependencies[name], api);
  const first = await api.get("test-key", "movie/123/release_dates");
  assert.equal(calls, 3);
  assert.equal(first.results[0].iso_3166_1, "US");
  first.results.length = 0;
  assert.equal((await api.get("test-key", "movie/123/release_dates")).results.length, 1);
  assert.equal(calls, 3);
});
