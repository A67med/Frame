// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { deduplicateAndRankSubtitleResults } from "../src/features/subtitles/search.ts";
import {
  isPublicNetworkHost,
  isSafeProviderSubtitleUrl,
  SUBTITLE_PUBLIC_NETWORK_HEADER,
} from "../src/features/subtitles/provider-url.ts";
import {
  providerSubtitleDownloadHeaders,
  subtitleTrackDownloadHeaders,
} from "../src/features/subtitles/provider-auth.ts";
import type { SubResult } from "../src/features/subtitles/types.ts";

test("provider subtitles accept only public HTTP(S) URLs", () => {
  for (const value of [
    "file:///tmp/private.srt",
    "C:\\private.srt",
    "\\\\server\\share\\private.srt",
    "smb://server/share/private.srt",
    "custom://player/private.srt",
    "data:text/plain,secret",
    "http://localhost/private.srt",
    "http://127.0.0.1/private.srt",
    "http://2130706433/private.srt",
    "http://10.1.2.3/private.srt",
    "http://100.64.0.1/private.srt",
    "http://172.16.0.1/private.srt",
    "http://192.168.1.2/private.srt",
    "http://169.254.1.2/private.srt",
    "http://[::1]/private.srt",
    "http://[fe80::1]/private.srt",
    "http://[fc00::1]/private.srt",
    "http://[fec0::1]/private.srt",
    "http://[2002:0a00:0001::1]/private.srt",
    "https://user:password@example.com/private.srt",
  ]) {
    assert.equal(isSafeProviderSubtitleUrl(value), false, value);
  }
  assert.equal(isSafeProviderSubtitleUrl("https://cdn.example.com/subtitle.srt"), true);
  assert.equal(isSafeProviderSubtitleUrl("http://1.1.1.1/subtitle.srt"), true);
  assert.equal(isPublicNetworkHost("2606:4700:4700::1111"), true);
});

test("provider result aggregation drops unsafe URLs before ranking", () => {
  const result = (id: string, url: string): SubResult => ({
    id,
    url,
    lang: "en",
    source: "addon",
  });
  assert.deepEqual(
    deduplicateAndRankSubtitleResults(
      [
        result("file", "file:///tmp/private.srt"),
        result("public", "https://cdn.example.com/a.srt"),
      ],
      ["en"],
    ).map((item) => item.id),
    ["public"],
  );
});

test("provider download policy is marked internally and pinned natively", () => {
  assert.deepEqual(
    providerSubtitleDownloadHeaders(undefined, "https://cdn.example.com/subtitle.srt"),
    { [SUBTITLE_PUBLIC_NETWORK_HEADER]: "1" },
  );
  const safeFetchSource = readFileSync(
    new URL("../src/infrastructure/networking/safe-fetch.ts", import.meta.url),
    "utf8",
  );
  const nativeSource = readFileSync(
    new URL("../src-tauri/src/infrastructure/networking/http_fetch.rs", import.meta.url),
    "utf8",
  );
  assert.match(safeFetchSource, /publicNetworkOnly/);
  assert.match(safeFetchSource, /policyHeaders\.delete\(SUBTITLE_PUBLIC_NETWORK_HEADER\)/);
  assert.match(nativeSource, /public_http_client\(&current_url\)/);
  assert.match(nativeSource, /let addresses = resolve_public_target\(url\)/);
  assert.match(nativeSource, /resolve_to_addrs\(host, &addresses\)/);
});

test("public-network policy applies only to provider-derived subtitle tracks", () => {
  const lanUrl = "http://192.168.1.20/subtitle.srt";
  assert.equal(subtitleTrackDownloadHeaders(undefined, lanUrl, false), undefined);
  assert.deepEqual(subtitleTrackDownloadHeaders(undefined, lanUrl, true), {
    [SUBTITLE_PUBLIC_NETWORK_HEADER]: "1",
  });
});

test("player bridges allow explicitly trusted generated tracks without weakening provider checks", () => {
  const mpvSource = readFileSync("src/features/player/engine/mpv.ts", "utf8");
  const html5Source = readFileSync("src/features/player/engine/html5/bridge.ts", "utf8");

  for (const source of [mpvSource, html5Source]) {
    assert.match(source, /metadata\?\.providerDerived \?\? Boolean\(metadata\?\.provider\)/);
    assert.match(source, /providerDerived && !isSafeProviderSubtitleUrl\(url\)/);
  }
  assert.match(
    mpvSource,
    /subtitleTrackDownloadHeaders\(\s*metadata\?\.downloadAuth,\s*url,\s*providerDerived,/,
  );
});
