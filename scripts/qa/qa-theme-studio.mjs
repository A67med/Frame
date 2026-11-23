// Run against a local Vite server. Uses a fresh browser context, never the user's profile.
// FRAME_QA_PACKAGE can point to an external package.json with Playwright installed.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const { chromium } = createRequire(process.env.FRAME_QA_PACKAGE || import.meta.url)("playwright");
const output = resolve(process.argv[2] || "theme-qa");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.FRAME_QA_BROWSER ? { executablePath: process.env.FRAME_QA_BROWSER } : {}),
  headless: true,
});
const results = [];
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(() =>
    localStorage.setItem(
      "harbor.onboarding",
      JSON.stringify({ onboarded: true, nudges: { "content-advisory": true } }),
    ),
  );
  const fontFailures = [];
  await context.route(/https:\/\/(cdn\.fontshare\.com|fonts\.gstatic\.com)\//, async (route) => {
    try {
      await route.fulfill({ response: await route.fetch({ timeout: 15000 }) });
    } catch {
      fontFailures.push(new URL(route.request().url()).hostname);
      await route.abort();
    }
  });
  if (process.env.FRAME_QA_MEDIA) {
    const clip = readFileSync(process.env.FRAME_QA_MEDIA);
    await context.route("**/__frame-theme-test.mp4", (route) =>
      route.fulfill({ contentType: "video/mp4", body: clip }),
    );
  }
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => errors.push(error.message));
  const initialize = async () => {
    await page.locator("[data-harbor-shell]").waitFor({ timeout: 180000 });
    await page.evaluate(() => {
      window.qaContext = (key) => {
        const el = document.querySelector("[data-harbor-shell]");
        let fiber = el[Object.keys(el).find((k) => k.startsWith("__reactFiber"))];
        while (fiber) {
          const value = fiber.memoizedProps?.value;
          if (value && key in value) return value;
          fiber = fiber.return;
        }
        throw Error(`Missing context ${key}`);
      };
    });
  };
  const snapshot = async (name) => {
    await page.screenshot({ path: resolve(output, `${name}.png`) });
  };
  const checkFrame = async () => {
    await page.waitForFunction(
      () =>
        document.documentElement.hasAttribute("data-frame-desktop") &&
        document.documentElement.dataset.themeLayout === "frame",
    );
    assert.ok(await page.locator("[data-frame-command]").count());
    assert.ok(await page.locator("[data-frame-navigation], [data-film-nav]").count());
  };
  const select = async (preset) => {
    await page.evaluate((id) => {
      const { settings, update } = qaContext("settings");
      update({ theme: { ...settings.theme, preset: id } });
      qaContext("setView").setView("home");
    }, preset);
    await checkFrame();
  };
  const studio = () => page.getByRole("dialog", { name: "Theme studio", exact: true });
  const openStudio = async () => {
    await page.evaluate(() => qaContext("openSettings").openSettings("theme"));
    await page
      .locator(".hset-rail")
      .getByRole("button", { name: "Your themes", exact: true })
      .click();
    await page.getByRole("button", { name: /Open studio/ }).click();
    await studio().waitFor();
  };
  await page.goto(process.env.FRAME_QA_URL || "http://127.0.0.1:1421", {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await initialize();
  await checkFrame();
  await openStudio();
  await checkFrame();
  await snapshot("default-studio");
  await studio().getByRole("button", { name: "Themes", exact: true }).click();
  for (const id of ["frame", "project-hail-mary", "la-la-land"]) {
    const thumbnail = studio().locator(`img[data-built-in-preview="${id}"]`);
    await thumbnail.waitFor();
    assert.ok(await thumbnail.evaluate((image) => image.complete && image.naturalWidth > 0));
  }
  await studio().getByLabel("Find a theme").fill("La La Land");
  await studio()
    .getByRole("button", { name: /^La La Land/ })
    .click();
  await checkFrame();
  await studio().getByRole("button", { name: "Look", exact: true }).click();
  await studio().getByRole("button", { name: "Reset theme", exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--frame-radius") === "8px",
  );
  await studio().getByLabel("Theme name", { exact: true }).fill("Studio QA custom");
  const radius = studio().getByRole("slider", { name: "Corner radius" });
  await radius.fill("20");
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--frame-radius") === "20px",
  );
  await page.waitForTimeout(500);
  await studio().getByRole("button", { name: "Reset theme", exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--frame-radius") === "8px",
  );
  await studio().getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--frame-radius") === "20px",
  );
  await studio().getByRole("button", { name: "Redo", exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--frame-radius") === "8px",
  );
  await studio().getByLabel("Theme name", { exact: true }).fill("Studio QA custom");
  await radius.fill("20");
  const downloadEvent = page.waitForEvent("download");
  await studio().getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadEvent;
  await download.saveAs(resolve(output, "studio-qa.framestyle"));
  await studio().getByRole("button", { name: "Save theme", exact: true }).click();
  await studio().waitFor({ state: "hidden" });
  await checkFrame();
  const savedId = await page.evaluate(() => qaContext("settings").settings.theme.preset);
  assert.ok(savedId.startsWith("user:"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await initialize();
  await checkFrame();
  assert.equal(
    await page.evaluate(() => document.documentElement.style.getPropertyValue("--frame-radius")),
    "20px",
  );
  await openStudio();
  await studio().getByLabel("Theme description").fill("Edited without duplicating");
  await studio().getByRole("button", { name: "Save changes", exact: true }).click();
  await studio().waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => qaContext("settings").settings.theme.preset), savedId);
  console.log("Studio interaction checks passed");
  results.push(
    "Default preview, design edit, reset, undo/redo, export, save, reload and edit existing theme passed",
  );

  const ids = [
    "frame",
    "noir-cinema",
    "aurora-frame",
    "minimal-frost",
    "editorial",
    "amoled",
    "retro-cinema",
  ];
  for (const id of ids) {
    await select(id);
    await page.waitForTimeout(1200);
    await snapshot(`${id}-home`);
    for (const view of ["discover", "movies", "shows", "library"]) {
      await page.locator(`[data-harbor-nav="${view}"]`).first().click();
      await page.waitForTimeout(900);
      await checkFrame();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${id}/${view} overflow`,
      );
      if (id === "minimal-frost" || id === "aurora-frame") await snapshot(`${id}-${view}`);
    }
    await page.evaluate(() =>
      qaContext("openMeta").openMeta({ id: "tt0816692", type: "movie", name: "Interstellar" }),
    );
    await page.locator("[data-frame-detail]").waitFor();
    await page.waitForTimeout(1200);
    await snapshot(`${id}-detail`);
    await page.evaluate(() => qaContext("openSettings").openSettings("theme"));
    await page.locator(".hset-rail").waitFor();
    await page.waitForTimeout(500);
    await snapshot(`${id}-settings`);
    await page.locator('[data-harbor-nav="home"]').click();
    await page.keyboard.press("/");
    await page.locator("[data-search-overlay]").waitFor();
    await snapshot(`${id}-search`);
    await page.keyboard.press("Escape");
    for (const width of [960, 640]) {
      await page.setViewportSize({ width, height: 800 });
      await checkFrame();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${id}/${width} overflow`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (process.env.FRAME_QA_MEDIA) {
      await page.evaluate(() => qaContext("settings").update({ playerEngine: "html5" }));
      await page.evaluate(() =>
        qaContext("openPlayer").openPlayer({
          url: location.origin + "/__frame-theme-test.mp4",
          title: "Theme playback check",
          meta: { id: "local:theme-qa", type: "movie", name: "Theme playback check" },
        }),
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll("video")].some((v) => v.currentTime > 0.5),
      );
      await page.mouse.move(700, 900);
      await page.keyboard.press("Space");
      await page.waitForFunction(() =>
        [...document.querySelectorAll("video")].some((v) => v.paused && v.currentTime > 0),
      );
      await snapshot(`${id}-player`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await initialize();
      results.push(`${id} HTML5 clip playback, pause and player screenshot passed`);
    }
    results.push(
      `${id} home, discover, movies, shows, library, detail, settings, search and 640/960 viewport checks passed`,
    );
    console.log(results.at(-1));
  }
  // Import through the actual file-picker handler, including a legacy layout.
  const imported = readFileSync(resolve(output, "studio-qa.framestyle"), "utf8");
  const importThroughUI = async (text) => {
    await page.evaluate(() => qaContext("openSettings").openSettings("theme"));
    await page
      .locator(".hset-rail")
      .getByRole("button", { name: "Your themes", exact: true })
      .click();
    await page.evaluate((text) => {
      const original = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type !== "file") return original.call(this);
        HTMLInputElement.prototype.click = original;
        const transfer = new DataTransfer();
        transfer.items.add(new File([text], "qa.framestyle", { type: "text/plain" }));
        this.files = transfer.files;
        this.dispatchEvent(new Event("change", { bubbles: true }));
      };
    }, text);
    await page.getByRole("button", { name: /Import a theme.*Choose file/s }).click();
  };
  await importThroughUI(imported);
  await page.waitForFunction(() => qaContext("settings").settings.theme.preset.startsWith("user:"));
  await checkFrame();
  await importThroughUI(
    imported
      .replace("layout: frame", "layout: dracula")
      .replace("name: Studio QA custom", "name: Legacy QA"),
  );
  await page.waitForFunction(() => document.documentElement.dataset.themeLayout === "dracula");
  assert.equal(await page.locator("[data-frame-command]").count(), 0);
  await openStudio();
  await studio().getByText("Legacy layout · Preserved", { exact: true }).waitFor();
  await studio().getByRole("button", { name: "Layout", exact: true }).click();
  await studio()
    .getByRole("button", { name: /^Frame Navigation rail/ })
    .click();
  await checkFrame();
  await studio().getByRole("button", { name: "Save as a new theme", exact: true }).click();
  await studio().waitFor({ state: "hidden" });
  await checkFrame();
  const legacy = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("harbor-theme");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction("kv", "readonly").objectStore("kv").get("custom-themes");
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            db.close();
            resolve(
              JSON.parse(read.result).find((t) => t.name === "Legacy QA" && t.layout === "dracula"),
            );
          };
        };
      }),
  );
  assert.ok(legacy, "The original legacy theme must survive saving a modern copy");
  results.push(
    "Exported file import, legacy preservation and explicit conversion saved as a separate copy passed",
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(output, "results.json"),
    JSON.stringify({ results, errors, fontFailures }, null, 2),
  );
  console.log(results);
} finally {
  await browser.close();
}
