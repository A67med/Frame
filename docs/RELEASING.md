# Releasing Frame (Windows x64)

Frame publishes a signed **Tauri in-app updater** artifact and a Windows 10/11 x64 NSIS installer through [`tauri-build.yml`](../.github/workflows/tauri-build.yml). The updater signature is not Windows Authenticode publisher signing.

## Release policy

- The checked-in version is the source of truth. Releases are **not** created after every push to `main`.
- Only a reviewed version bump, merged into the protected `main` branch, can produce a new version. A push that leaves the version unchanged is a no-op for releases.
- The release workflow itself never commits or pushes to `main`. This allows branch protection and required reviews to work without a GitHub Actions bypass.
- The workflow publishes a release automatically when `main` contains a valid, as-yet-unpublished version, or may be run manually to retry it.
- Do not rewrite published Git tags or rotate Tauri updater signing keys to repair a release.

## How to release

1. Merge the intended application changes into `main` after CI passes. These changes **do not** automatically release while their version is unchanged.
2. Start a new branch from updated `main`. Choose the next version (for example, `0.4.10` after `0.4.9`).
3. Run the following in a working copy:

   ```sh
   node scripts/bump-version.mjs 0.4.10
   node scripts/check-release-version.mjs v0.4.10
   pnpm test
   ```

4. Review the version change in all five files: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `flatpak/io.github.abdallahkattriah_sketch.Frame.metainfo.xml`.
5. Add `docs/releases/v0.4.10.md` with a clear, user-facing changelog. If omitted, `scripts/release-notes.mjs` generates notes from conventional commit subjects.
6. Open a pull request and await required checks/review. Merge into `main` only after validation.
7. Follow [Release (Windows x64)](https://github.com/A67med/Frame/actions/workflows/tauri-build.yml). Its prepare job checks all version files, ensures the release is not already published, and verifies any existing tag matches the branch head. The Windows job builds and signs; the publish job creates the release and updater manifest.

After publishing, verify the `Frame_<version>_x64-setup.exe` installer, `latest.json`, release notes, and SHA-256 in the latest release. Update a previous installation and test the updater on Windows before announcing the release.

## Protecting the main branch

In GitHub **Settings → Rules → Rulesets**, create a branch ruleset targeting `main`. Prefer:

- Require a pull request before merging; require one approval **if another maintainer can review**. A solo maintainer should not set an unattainable approval requirement.
- Require successful `Frontend` and `Native` checks from the **Code Quality** workflow. These run on pull requests. Consider adding `Windows x64` from **App build** only when GitHub confirms it runs for every type of PR you plan to merge.
- Block force pushes and branch deletion. Do not allow bypasses unless required by an explicitly documented recovery process.
- Do not prevent GitHub Actions from creating release tags, and do not enable rules that require the release workflow to push directly to `main` — it does not.

Check that a small docs PR can pass the branch rules before treating them as finalized. Review [`AGENTS.md`](../AGENTS.md) for build and compatibility quirks.

## Recovery

- **Same version already published:** the workflow correctly skips. Do not attempt to publish an unrelated commit under that version.
- **Tag exists, no release yet:** a controlled manual workflow retry is permitted **only if the tag targets the same commit**.
- **Mismatched version files, older version, or tag points elsewhere:** correct the release PR; never force-update a public tag.
- **Signing key missing:** configure the existing `TAURI_SIGNING_PRIVATE_KEY` in GitHub Actions secrets. Do not generate a new key without planning for a manual upgrade.
- **Asset verification fails:** fix the build or packaging workflow in a PR and rerun for the **same approved, unpublished version**; do not bypass checks.
