# Reference disposition

LangLoop uses an independent implementation. No modules, images, fonts, icons, or grammar dictionaries from the reference products are incorporated. Their README feature claims have not been treated as integration proof.

| Repository | Reviewed HEAD | Repository license | Disposition |
|---|---|---|---|
| [riponcm/GemType](https://github.com/riponcm/GemType) | `38531551572db9c9d819dfe978ca1f3a5be182f8` | Apache-2.0 | No code, assets, or dependencies copied; behavioral reference only. |
| [swadhinbiswas/opengrammar](https://github.com/swadhinbiswas/opengrammar) | `0bb31872436de3ea230e68ca08afb748e3e51757` | Apache-2.0 | No code, assets, or dependencies copied; behavioral reference only. |
| [Automattic/harper](https://github.com/Automattic/harper) | `81dbff3d55f48935b93883bc34f9fef325802bdd` | Apache-2.0 | No code, assets, or dependencies copied; behavioral reference only. |
| [MikkoParkkola/translate-browser-extension](https://github.com/MikkoParkkola/translate-browser-extension) | `6970b3479249d0de2f2ae71c190d5f3ea558ebe4` | GPL-3.0 | No code, assets, or dependencies copied; behavioral reference only. |

GemType informed the explicit correction/Undo use case; OpenGrammar informed the configurable-provider use case; Harper is deferred; TRANSLATE! informed article translation goals only. Native Grammarly-like underlines, Harper integration, and dynamic feed translation are outside this release. Future reuse requires revision-specific LICENSE/NOTICE and asset inspection before incorporation. Dependency versions and licenses are recorded in THIRD_PARTY_NOTICES.txt from the installed lockfile.

## Adapted subscription protocols

The independent-implementation statement above concerns the four language-assistance reference projects. The following later integration adapts public OAuth client constants and native protocol fields and therefore retains its upstream license notice.

| Source | Reviewed revision | License | Actual use |
|---|---|---|---|
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI/tree/7fa443dc8bf8ca2f1ffd81c2472deb31b097b697) | `7fa443dc8bf8ca2f1ffd81c2472deb31b097b697` | MIT | OAuth constants/flows and native text protocol fields in `src/oauth.ts`, `src/oauth-code.ts`, `src/native-subscriptions.ts`; no upstream executable bundled. |
| [OpenAI Codex](https://github.com/openai/codex) | Initial protocol inspection was not pinned in the retained source record | Apache-2.0 | Device authorization, account-model discovery and Responses protocol reference for the independently written `src/chatgpt.ts`; no Codex source modules bundled. |

CLIProxyAPI's full attribution and permission notice are retained in [licenses/CLIProxyAPI.txt](../licenses/CLIProxyAPI.txt), and included in the packaged [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt). `scripts/notices.mjs` preserves this notice when regenerating dependency notices. Public installed-client OAuth constants do not establish provider approval or a right to use a subscription outside its terms.

## Runtime dependencies and test fixtures

Exact npm dependency versions are recorded in [package-lock.json](../package-lock.json). [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt) contains dependency attribution and full license text for runtime packages. The frozen Draft.js browser fixture separately retains upstream MIT licenses beside its assets:

- [Draft.js 0.11.7](https://www.npmjs.com/package/draft-js/v/0.11.7) — [license](../tests/fixtures/draft-vendor/LICENSE-draft.txt).
- [React and React DOM 16.14.0](https://www.npmjs.com/package/react/v/16.14.0) — [license](../tests/fixtures/draft-vendor/LICENSE-react.txt).
- [Immutable 3.8.2](https://www.npmjs.com/package/immutable/v/3.8.2) — [license](../tests/fixtures/draft-vendor/LICENSE-immutable.txt).

These test fixtures are not shipped in the extension. The LangLoop icon is an original AI-generated project asset; provenance is described in [public/BRAND.md](../public/BRAND.md). Product names such as Grammarly and Trancy describe interaction references only; their code, logos and other assets are not incorporated. Those product names and service names belong to their respective owners.


## Documentation references

README organization was reviewed against [GemType](https://github.com/riponcm/GemType) and [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard) on 2026-09-14: download-first navigation, first-run setup, task-oriented usage, and separation of end-user installation from developer build instructions. LangLoop's English and Traditional Chinese instructions were written for its own current behavior. No prose, screenshots, logos or workflow code were copied from these documentation references. This documentation review does not change the earlier source-code reference revisions above.
