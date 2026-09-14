# Privacy

LangLoop has no account, hosted backend, analytics or telemetry. It only reads requested text after an explicit extension action. Excluded domains are checked before extraction and provider submission; subdomains are also excluded. Password inputs and recognized sensitive fields are excluded. Select or paste only text you intend to process.

Requested text and necessary article context go directly to the API origin you configure. Cloud processing is governed by that provider's policies. Configuring Ollama on loopback sends requests locally, but LangLoop cannot attest to a user-managed service's downstream behavior. It does not describe arbitrary custom endpoints as private/local.

API keys stay in local Chrome extension storage with content-script access disabled. This is not an encrypted vault. They are never included in backup, sync or logs. Remote endpoints require HTTPS; local loopback HTTP is supported. Redirects are rejected.

Cards are saved only when you click Save. Their excerpts, explanations and optional source URL remain in local IndexedDB. Delete cards from My learning. Article translations have a bounded local cache; clear it in Settings. Selection/draft results are not persisted as learning records automatically. A captured selection is held in session storage for the side panel and cleared when the browser session ends. Backups contain personal saved text and non-secret preferences; protect exported files accordingly.

Uninstalling deletes local extension data. Manual replacement and Reload preserve it if the same extension identity is retained. No Chrome Web Store publication or automatic update mechanism is included.

## Direct ChatGPT sign-in

ChatGPT device authorization is initiated only by clicking Sign in. The extension calls auth.openai.com directly; users complete authorization on OpenAI's own page. Pending device authorization is stored in trusted extension session storage and expires after 15 minutes. Access and refresh tokens are stored separately from exportable settings in trusted local extension storage, which is not an encrypted vault. They are never passed to web-page scripts or exported. Sign out clears these tokens and cancels pending model requests.

Requested text is sent directly to chatgpt.com using the Codex Responses endpoint. Opening settings or signing in does not submit a translation. Successful account connection does not prove a model request will succeed. There is no required local daemon, proxy management page, native helper or hosted LangLoop backend. Custom API model discovery is explicit and submits no draft text.

On-page tools load automatically on HTTP/HTTPS pages allowed by Chrome, excluding sites configured in LangLoop. Version 0.1.1 requests HTTP/HTTPS site access to display these controls. Opening the floating launcher and focusing an editor do not send text to the model. Page translation and field correction each require a button click; selected page paragraphs or the focused field text are then sent to the configured provider. Web-page messages are limited to the current top-level tab URL and this extension and cannot retrieve settings, tokens or backups.

User-defined writing context is stored locally with settings and included in exported preferences. When a translation, correction or rewrite is requested, the context is sent to the configured AI provider together with the requested text. Local detection of Han characters on clicking a writing badge only selects UI choices and does not call the provider.

Paired writing review sends the draft and the selected context in one explicit request for two variants. Content-script configuration exposes only profile names/IDs and defaults, never prompt bodies or credentials. Full context profiles stay in trusted settings and exported preferences; page reading translation does not use writing-profile tone.

## Multiple account connections
Connection records and API keys remain in extension-local storage. OAuth access and refresh tokens are isolated by connection ID and restricted to trusted extension contexts. They are not encrypted by a separate vault: access to the browser profile or a compromised extension can expose them. Backups exclude the connection vault and OAuth tokens; exporting preferences does not migrate account logins. Removing a connection clears its local authentication records, but does not revoke sessions at the provider.

Direct subscription integrations contact only their fixed provider authorization and inference endpoints. No CLIProxyAPI service or remote proxy is required. Authorization-code integrations observe the callback navigation in the login tab without starting a localhost listener. Google installed-client protocol constants are public upstream identifiers, not a private LangLoop application secret. Provider authorization and browser compatibility must be verified separately from local protocol tests.
