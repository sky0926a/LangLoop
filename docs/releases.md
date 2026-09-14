# Release guide

Distribute the prebuilt ZIP through GitHub Releases. End users extract it and load the folder in Chrome Developer mode; they do not compile TypeScript or start a companion service. This does not provide store installation or automatic extension updates. Chrome's [unpacked installation guidance](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions) describes the browser-side restrictions.

## Local package

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run package
npx playwright install chromium
npm run test:e2e
npm run release:prepare
```

`dist/release/` contains:

| File | Purpose |
|---|---|
| `langloop-extension.zip` | Prebuilt extension with manifest, scripts, icon and license notices. |
| `SHA256SUMS.txt` | SHA-256 checksum of that ZIP. |
| `INSTALL.txt` | English and Traditional Chinese install/update instructions. |
| `RELEASE-NOTES.md` | Generated draft release body. |

`release:prepare` requires an existing matching build. Set `RELEASE_TAG=vX.Y.Z` to enforce that a proposed tag matches `package.json`. The packaged manifest must also match. No signing private key, cloud account token, or application API key is needed for the build. `public/identity.txt` is public and keeps unpacked extension identity consistent.

## Run in GitHub Actions without publishing

After the workflow is committed and pushed to the repository's default branch, open **Actions → Build extension release → Run workflow**. It runs lint, type checking, unit and browser tests, checks license notices, builds the ZIP and uploads `langloop-release` as an Actions artifact for 14 days. Manual runs do not create a Release.

Actions artifacts are intended for maintainer testing and may require GitHub sign-in. The downloaded artifact is a wrapper ZIP containing the actual `langloop-extension.zip`; extract the wrapper first. A published Release is the public download path for users.

## Create a release draft from a version tag

When authorized to publish a version:

1. Set the version using `npm version X.Y.Z --no-git-tag-version` (replace X.Y.Z with three numeric components), review the change and commit all intended release files.
2. Push the reviewed commit and workflow to GitHub.
3. Tag that commit as `vX.Y.Z`, then push that tag. The tag version must exactly match `package.json` and the packaged manifest.
4. Wait for **Build extension release** to pass. Its final job creates a **draft Release** with the ZIP, checksums and installation instructions.
5. Review the draft notes, add version-specific changes, test the download and choose **Publish release** when ready.

There is no automatic Chrome Web Store submission. A draft is not publicly downloadable. The workflow does not overwrite existing Releases or silently create missing tags; if a draft already exists, inspect it before rerunning the release job. GitHub CLI's [`gh release create`](https://cli.github.com/manual/gh_release_create) documents draft and tag-verification behavior.

After publication, the stable public download link is:

https://github.com/sky0926a/LangLoop/releases/latest/download/langloop-extension.zip

Keep the asset name stable so this link continues to work. Users must still reload their unpacked extension and refresh pages after replacing the files.

## Workflow permissions and scope

Build jobs have read-only repository access. Third-party Actions are pinned to commit hashes; checkout does not retain Git credentials. Only the separate draft-release job receives `contents: write`, after tests succeed. It uses the built-in `GITHUB_TOKEN` for this repository; no personal access token is needed. Untrusted pull-request code does not trigger a release job.

The workflow is configured locally, but a successful local build is not evidence of a completed GitHub-hosted run. Review the Actions result after pushing. Update pinned Actions intentionally according to GitHub's [secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).
