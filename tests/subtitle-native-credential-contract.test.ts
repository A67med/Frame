// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("subtitle credential commands are registered on Windows", () => {
  const desktop = read("src-tauri/src/lib.rs");
  for (const command of ["subtitle_credential_bind", "subtitle_credentials_clear"]) {
    assert.match(desktop, new RegExp(`features::subtitles::credentials::${command}`));
  }
});

test("safe fetch transports the opaque handle outside outbound headers", () => {
  const safeFetch = read("src/infrastructure/networking/safe-fetch.ts");
  assert.match(safeFetch, /k\.toLowerCase\(\) === SUBTITLE_CREDENTIAL_HEADER/);
  assert.match(safeFetch, /credentialHandle = v/);
  assert.match(safeFetch, /credentialHandle,/);

  const nativeFetch = read("src-tauri/src/infrastructure/networking/http_fetch.rs");
  assert.match(nativeFetch, /credential_handle/);
  assert.match(nativeFetch, /features::subtitles::credentials::resolve/);
  assert.match(nativeFetch, /features::subtitles::credentials::apply_to_request/);
  assert.match(nativeFetch, /subtitle_credential = None/);
});

test("URL and Request inputs retain the guarded native fetch path", () => {
  const safeFetch = read("src/infrastructure/networking/safe-fetch.ts");
  assert.match(safeFetch, /input instanceof URL\) return tauriStringFetch\(input\.href, init\)/);
  assert.match(
    safeFetch,
    /materializeRequest\(input, init\)\.then\(\(request\) =>[\s\S]*?tauriStringFetch\(request\.url, request\.init\)/,
  );
});

test("sensitive requests cannot use the browser direct-host fast path", () => {
  const safeFetch = read("src/infrastructure/networking/safe-fetch.ts");
  assert.match(
    safeFetch,
    /const directHost = hasSensitiveRequestHeaders\(init\?\.headers\) \? null : directHostFor\(input\)/,
  );
});
