import assert from "node:assert/strict";
import test from "node:test";
import "./_localstorage-stub.ts";
import { clearCollectionItems, getCollection } from "../src/features/collections/store.ts";

test("clearing videos from a legacy collection preserves retired reader entries", () => {
  const retired = { id: "book", type: "manga", name: "Archive" };
  localStorage.setItem(
    "harbor.collections.v1",
    JSON.stringify([
      {
        id: "shelf",
        name: "Shelf",
        items: [retired, { id: "film", type: "movie", name: "Film" }],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
  clearCollectionItems("shelf");
  assert.deepEqual(
    getCollection("shelf").items.map(({ id, type, name }) => ({ id, type, name })),
    [retired],
  );
});

test("updating a video download preserves the original reader record", async () => {
  const retired = {
    id: "archive",
    path: "untouched",
    kind: "ebook",
    status: "done",
    legacyMetadata: { author: "A" },
  };
  localStorage.setItem(
    "harbor.downloads.v1",
    JSON.stringify([
      retired,
      { id: "video", path: "local-video", url: "file:local-video", status: "paused" },
    ]),
  );
  const { removeDownload, downloadsSnapshot } =
    await import("../src/lib/download/downloads-store.ts");
  assert.deepEqual(
    downloadsSnapshot().map((d) => d.id),
    ["video"],
  );
  removeDownload("video");
  assert.equal(downloadsSnapshot().length, 0);
  assert.deepEqual(JSON.parse(localStorage.getItem("harbor.downloads.v1"))[0], retired);
});
