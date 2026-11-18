import assert from "node:assert/strict";
import test from "node:test";
import { renderReleaseNotes } from "../scripts/release-notes.mjs";

test("release notes have only populated headings", () => {
  const text = renderReleaseNotes([
    "fix(build): extract Windows ffmpeg ZIP with bsdtar",
    "docs: clarify setup",
    "chore(release): prepare v0.4.10 [skip ci]",
  ]);

  assert.match(text, /### Fixes\n\n- Extract Windows ffmpeg ZIP with bsdtar \(build\)/);
  assert.match(text, /### Documentation\n\n- Clarify setup/);
  assert.doesNotMatch(text, /### (Features|Performance|Other)/);
  assert.doesNotMatch(text, /Prepare v0\.4\.10/);
  assert.doesNotMatch(text, /### [^\n]+\n\n###/);
});

test("release notes group internal changes without empty sections", () => {
  assert.equal(
    renderReleaseNotes(["chore(repo): update contribution docs"]),
    "### Build and maintenance\n\n- Update contribution docs (repo)",
  );
});

test("release notes handle no changes", () => {
  assert.equal(renderReleaseNotes(["", "chore(release): prepare v1.2.3"]), "No changes since the previous release.");
});
