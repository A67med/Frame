#!/usr/bin/env node
// `node scripts/release-notes.mjs <from-ref> [to-ref]` produces Markdown
// release notes from conventional commit subjects, omitting empty sections.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GROUPS = [
  ["Features", /^feat$/],
  ["Fixes", /^fix$/],
  ["Performance", /^perf$/],
  ["Documentation", /^docs$/],
  ["Build and maintenance", /^(ci|build|chore|test|refactor|style)$/],
  ["Other", /.*/],
];

export function renderReleaseNotes(subjects) {
  const sections = new Map(GROUPS.map(([name]) => [name, []]));

  for (const raw of subjects) {
    const subject = raw.trim();
    if (!subject || /^chore\(release\)!?:/.test(subject)) continue;

    const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
    const type = match?.[1] ?? "";
    const scope = match?.[2];
    const summary = (match?.[4] ?? subject).trim();
    if (!summary) continue;

    const sentence = summary.charAt(0).toUpperCase() + summary.slice(1);
    const line = `- ${sentence}${scope ? ` (${scope})` : ""}`;
    const group = GROUPS.find(([, pattern]) => pattern.test(type))[0];
    sections.get(group).push(line);
  }

  const output = [];
  for (const [name, lines] of sections) {
    if (!lines.length) continue;
    output.push(`### ${name}`, "", ...lines, "");
  }

  return output.length ? output.join("\n").trimEnd() : "No changes since the previous release.";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [from, to = "HEAD"] = process.argv.slice(2);
  if (!from) {
    console.error("usage: node scripts/release-notes.mjs <from-ref> [to-ref]");
    process.exit(1);
  }

  const log = execFileSync("git", ["log", "--no-merges", "--format=%s", `${from}..${to}`], {
    encoding: "utf8",
  });
  console.log(renderReleaseNotes(log.split("\n")));
}
