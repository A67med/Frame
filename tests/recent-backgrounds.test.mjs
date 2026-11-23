import assert from "node:assert/strict";
import test from "node:test";
import "./_indexeddb-stub.ts";
import {
  backgroundId,
  changeRecentBackgrounds,
  readRecentBackgrounds,
  loadRecentBackground,
  loadBgImage,
  saveBgImage,
} from "../src/lib/theme-storage.ts";

test("profile galleries deduplicate, cap managed images, and clear independently of the active wallpaper", async () => {
  const add = async (profile, data) =>
    changeRecentBackgrounds(profile, {
      add: { id: await backgroundId(data), name: data, thumbnail: "test" },
      data,
    });
  await saveBgImage("original", "one");
  for (let n = 0; n < 9; n++) await add("one", String(n));
  await add("one", "3");
  await add("two", "0");
  assert.equal((await readRecentBackgrounds("one")).length, 8);
  assert.equal((await readRecentBackgrounds("one"))[0].name, "3");
  assert.equal(await loadRecentBackground("one", await backgroundId("0")), null);
  await changeRecentBackgrounds("one", { remove: await backgroundId("3") });
  assert.equal(await loadRecentBackground("one", await backgroundId("3")), null);
  await changeRecentBackgrounds("one", { clear: true });
  assert.deepEqual(await readRecentBackgrounds("one"), []);
  assert.equal(await loadBgImage("one"), "original");
  assert.equal(await loadRecentBackground("two", await backgroundId("0")), "0");
});
