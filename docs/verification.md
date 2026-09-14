# Verification and limitations

The maintained suites use synthetic drafts and deterministic provider responses. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:e2e` after building with `npm run package`. Playwright exercises the packaged extension in a separate browser profile.

## Covered behavior

- Provider request validation, bounded responses, timeouts, source guards and cancellation.
- Named account isolation, automatic Agent names, serialized creation, stale saves and scoped credential removal.
- OAuth callback state, PKCE, owned-tab binding, replay rejection and cancellation during token exchange.
- Local-only cards, secret-free backups, migration and stable extension identity.
- Bilingual page insertion/restoration, batching, field suggestions, granular differences, explicit apply/undo, editable drafts and resizable dialogs with expand/compact controls and a persistent close button.
- Settings sections, account switching, interface languages and removal confirmation.

## External acceptance

A passing fixture is not proof of real provider authorization or inference. Direct subscription adapters remain experimental. New providers still require real-account authorization, model discovery and inference verification in Chrome. Google requires a provisioned Antigravity project; Devin currently needs a manually entered model UID and periodic sign-in. Browser transport or public CLI OAuth clients may be rejected by a provider.

Company-site behavior, universal rich-editor compatibility, and all browser/device combinations are not guaranteed by the local fixtures. Local browser-profile storage is not an encrypted vault; scoped security tests do not establish zero risk.

Per-run logs, screenshots, installation receipts and historical investigations stay in ignored `.local/` or test output directories rather than version control.


## Release automation

The release workflow checks lint, types, unit/browser behavior, dependency notices and version agreement before producing downloadable assets. It creates draft releases only for version-tag pushes; manual runs produce Actions artifacts. Local validation includes Actionlint, package loading, checksum verification and rejection of a mismatched release tag. GitHub-hosted execution and actual Release publication remain separate acceptance steps.
