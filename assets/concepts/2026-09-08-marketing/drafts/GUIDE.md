# AI Usage Tracker v0.2.5 user guide

[Back to README](README.md) · [Downloads](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases/tag/v0.2.5)

## First reading

Install the extension, sign in to the provider normally, and visit its usage page. Claude uses `https://claude.ai/settings/usage`; Codex uses `https://chatgpt.com/codex/cloud/settings/analytics#usage`. Open the tracker and select Refresh.

The default refresh interval is five minutes. The extension uses first-party session endpoints where available, with page observations as another source. Hidden fallback tabs are a separate opt-in under Refresh. They aren't enabled automatically.

The widget stays on supported provider pages. Drag it to a suitable position or minimize it to a small corner badge. On a narrow or touch-oriented userscript viewport, it anchors near the bottom without depending on dragging. The toolbar popup and Chromium side panel use the same local state.

Quota rings show the percentage **remaining**. The summary banner and toolbar badge show the most constrained percentage **used**. Reset text combines the provider's timestamp with a countdown. Per-model rows can be enabled under Display; an absent row doesn't mean that provider has unlimited usage.

Hover or focus a sparkline to inspect a sample. A pace marker uses recent history to project usage near reset. A projection can change quickly, especially with a short history.

## Alerts

Settings > Notifications lets you test notification support before relying on it. Browser, OS, and userscript-manager permissions can each affect delivery. Snooze pauses alerts.

Available rules cover approaching resets (60 minutes, 15 minutes, and at reset), renewal arrival, usage thresholds (75%, 90%, and 95%), and a burn-rate warning. Spike detection is optional. The daily briefing defaults to 08:00 local time.

Missed events have a bounded catch-up window. A sleeping browser can delay service-worker alarms. The userscript can only catch up while a provider tab is open; neither channel guarantees delivery at an exact second.

API spend caps are local alerts, not payment limits. Set a session or daily cap to receive notices at 80% and 100% of observed spend. Blank or zero disables a cap. The first cumulative sample becomes a baseline, so it isn't retroactively charged to the session. Missed refreshes cannot be reconstructed.

### Webhook alerts

Webhooks are off by default. Enable one under Notifications, enter an HTTP(S) endpoint, and grant that origin when requested. Prefer HTTPS. The default event contains rule metadata; provider, bucket, percentage, reset, title, and body details require a separate opt-in.

Requests use bounded retries. Delivery status and the endpoint stay local and aren't included in diagnostics. A webhook does send data to its configured destination. Check who controls that endpoint before enabling details.

## Optional API analytics

These integrations are implemented in the extension. They are separate from Claude and Codex chat subscriptions, and do not imply access to all of a provider's metrics. Account entitlements and API contracts can change. The release's local tests use redacted fixtures, not live authenticated accounts.

| Integration | Configuration in this project | Data represented |
| --- | --- | --- |
| Anthropic API | Admin credential with usage/cost access | Month-to-date tokens and Cost Report totals where returned |
| OpenAI API | Organization admin credential with usage/cost access | Token breakdowns, local model-price estimates, and separate Costs reconciliation |
| GitHub Copilot | Token, organization, and username with seat-read access | Seat plan and last activity, not a remaining-message counter |
| Cursor | Team admin API credential | Daily request totals and current-cycle spend |
| Gemini | Google Cloud Monitoring OAuth token and project ID | Output-token and request metrics for the configured project |
| OpenRouter | API credential; management access where required | Key usage/limits and account credits where returned |

Save a credential only after checking its permissions with the provider. The extension requests the relevant optional origin when the integration is configured. Session or memory-only storage is the default. Persistent local storage is a compatibility option when restart recovery is needed. No storage mode replaces a credential vault.

Stored values aren't displayed again. Remove the local credential and revoke it at the provider when it is no longer needed. Disabling a provider or deleting its local profile clears its credential records.

The API breakdown groups available dimensions by provider, workspace, project, shortened key identifier, and model. CSV exports omit credential values, but you should still review labels and identifiers before sharing.

### Estimates and cost guidance

OpenAI model-level costs use a versioned local price table; unknown models remain token-only. Provider cost totals are kept distinct from those estimates. A local table can lag a price change.

Month-end forecasts project an observed daily run rate through the current UTC month. They require more than a full day of cost coverage and disclose freshness and assumptions. Short or stale coverage lowers confidence.

Plan-review hints require seven days of fresh coverage and provider-reported limits or usage mix. They don't know current plan names, prices, or contract terms. Use them as a reason to check your account, not as purchasing advice.

Claude context usage estimates visible conversation text and the draft against a local reference window. It cannot account for every hidden instruction, attachment, or provider model change. The five-minute cache timer and 24-hour/seven-day reuse ratios are inferred from stream observations unless an explicit expiry is returned. They aren't provider billing counters.

## Profiles, history, and sharing

Settings > Profiles keeps independent local settings, snapshots, history, and credentials. It does **not** sign into a different provider account for you. One profile must remain; deleting a profile removes its local records.

Operational history retains 30 days by default. Settings > History offers CSV export, retention controls, representative-sample compaction, and clearing. Export a copy before removing history you may need.

Long-horizon archives use a separate bounded JSON format. Import merges archive samples deterministically without changing operational retention, current snapshots, settings, budgets, or credentials. Unsupported, oversized, or secret-bearing inputs are rejected.

Browser settings sync is off by default and is extension-only. It carries selected display, locale, refresh, retention, and notification preferences. It doesn't sync snapshots, history, credentials, or native scheduler configuration.

Chromium's split-incognito mode uses separate storage keys and displays an Incognito marker. The Firefox build disables private-window execution because it cannot provide that same split behavior.

### Local team dashboard

Enable Settings > Team to aggregate user-provided contribution or ledger files on one device. Export a redacted contribution, share it through a channel you choose, and import teammates' files manually.

Base contributions contain user-chosen labels and aggregate provider cost, token, and request totals. They omit prompts, source code, credentials, and paths. Client, project, and branch labels are a separate manual opt-in for invoicing CSV. The extension does not inspect local Git repositories or automatically share team data.

### Local MCP server

Use Settings > Status > Export MCP state to save an explicit redacted snapshot. From the source checkout, run:

```sh
node mcp/server.mjs --state /absolute/path/to/usage-state.json
```

Configure your MCP client to start that command over stdio. Available tools are `get_usage`, `forecast`, and `time_to_reset`. The process reads only the supplied file. It doesn't access browser storage, refresh a provider, or receive credentials. Export a new file when you need a fresh reading.

## Permissions and data

| Permission or destination | Purpose and limits |
| --- | --- |
| Storage | Local profiles, preferences, history, and separate credential records; optional preference sync |
| Alarms and notifications | Schedule refreshes and requested alerts |
| Tabs | Open usage pages and optional hidden fallback tabs; it does not request cookie access |
| Side panel | Chromium's persistent local dashboard |
| `claude.ai`, `chatgpt.com` | Signed-in first-party requests and page observations; content scripts also match their subdomains |
| Six optional API origins | Provider-specific analytics after configuration and origin approval |
| Optional HTTP(S) origins | The manifest permits a configured webhook origin to be requested, not blanket access granted by default |
| Native messaging | Only the separate bridge channel; local QuotaGlass display data and scheduler messages |

Normalized state stays in browser storage or the userscript-manager store. First-party requests use your provider session. Optional API requests use the configured credential. No tracker analytics service or relay is bundled.

The Claude context counter inspects visible conversation text locally for estimation; that does not make exported usage a transcript. Support bundles omit prompts, history, credentials, cookies, full identifiers, and raw provider errors. Still inspect an export before sharing it.

## Updates and removal

Download the new Chromium ZIP, extract it over your installed extension directory, and select Reload on the browser's Extensions page. Keep the same extension location and pinned key if you want browser storage continuity. Back up important history first.

The userscript metadata points to the latest release asset for updates. Your manager controls the update schedule.

To remove the tracker, export any history you need, then remove the extension or userscript through its manager. Revoke optional API credentials at their providers. Unregister a native helper if you installed one; removing the default extension does not uninstall a separate companion.

## Optional desktop bridge

Default packages omit `nativeMessaging`. If you use the QuotaGlass companion, the separate bridge build adds that permission without changing quota collection:

```sh
npm run build:bridge
```

It produces `AI-Usage-Tracker-chrome-bridge-v0.2.5.zip`, the local unsigned development file `ai-usage-tracker-firefox-bridge-v0.2.5.xpi`, and `AI-Usage-Tracker-native-scheduler-v0.2.5.zip`. The Firefox file is not a published installation asset.

The Python 3.10+ scheduler keeps an opt-in native pipe open and emits wake messages for the next refresh or notification deadline. Browser alarms remain a fallback. Scheduler messages contain the interval and next deadline, not usage details. This is separate from the companion's redacted display envelope.

Extract the native scheduler ZIP. Preview registration before writing it:

```sh
python register_scheduler_host.py --host-path /absolute/path/to/ai_usage_tracker_scheduler.py --browser all --dry-run
```

On Windows, use `py -3` and an executable host path built with the included `build_scheduler_host.ps1`. That build requires PyInstaller in the Python environment selected by `py -3`. A local executable isn't code-signed unless you supply a certificate; don't assume it will bypass OS warnings. Registration writes per-user browser keys on Windows or user-level host manifests on macOS/Linux. Remove `--dry-run` only when the path and allow-list are correct.

The registration helper accepts `--unregister --browser chrome` to remove its Chrome registration. Choose the browser you actually registered; `all` affects every supported browser. On Windows, also provide the original `--manifest-dir` if you want its generated manifests removed. Otherwise, those files remain. Removal is immediate: `--dry-run` does not preview the unregister branch.

Install the bridge extension, then enable **Use the local scheduler helper** under Refresh. It is off by default and doesn't sync across devices. The release acceptance checks exercise its protocol and registration dry-run, not a user's QuotaGlass installation.

## Firefox development build

`npm run build` produces `dist/firefox` and `ai-usage-tracker-firefox-v0.2.5.xpi`. They are unsigned development artifacts. In Firefox, open `about:debugging`, select This Firefox, choose Load Temporary Add-on, and pick `dist/firefox/manifest.json`. This temporary installation ends at restart and is not a normal end-user distribution.

Don't disable signature checks. A release install requires [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), which is still pending for this project.

## Development and verification

The repository uses plain ES modules and esbuild. Runtime bundles are readable and not minified. The package declares Node.js 20+ for builds. The local acceptance run used Node.js 24 with npm; packaged-browser tests need Node.js 22.4 or newer for the stable built-in WebSocket client. See [Node's WebSocket history](https://nodejs.org/download/release/v22.8.0/docs/api/globals.html#websocket).

```sh
npm ci
npm test
npm run build
npm run test:runtime
```

The runtime lane uses fresh temporary profiles with headless Chromium and Firefox, plus geckodriver. Set `AUT_CHROME_PATH`, `AUT_FIREFOX_PATH`, and `AUT_GECKODRIVER_PATH` if discovery cannot find them. Use a Chromium build that supports unpacked loading and a current geckodriver that accepts `--allow-system-access`; the runner restricts extension-page automation to its own Firefox profile.

Chromium coverage includes service-worker startup/restart, permissions, content messaging, stale state, split-incognito storage, wide/narrow layouts, Arabic/high contrast, reduced motion, axe checks, and userscript inline-dialog behavior. Firefox coverage installs the local XPI temporarily and opens its popup and settings. This is not a claim that both browsers received identical accessibility coverage or that every userscript manager was exercised.

`npm test` checks the strict model boundary and ratchets other covered files against 1,147 existing TypeScript diagnostics. It also runs local provider, storage, notification, and UI fixtures. It doesn't authenticate provider accounts.

`npm run build:release` additionally packages the optional bridge and signs Chromium CRX3 files with `AUT_SIGNING_KEY`, or the local ignored `aut-selfhost.pem`. The key must match the manifest's pinned public key. It does not create or replace signing keys. ZIPs remain the primary install files. Published checksums use download basenames and exclude unsigned Firefox development files.

### Provider authoring

Register reviewed adapters in `src/providers/registry.js` using `src/providers/plugin-api.js`. The versioned contract separates `auth`, `fetch`, `parse`, and `normalize`. Credentials belong only in the request/auth boundary and are withheld from public parse/normalize contexts.

Declare explicit capability booleans for token usage, requests, cost, and quota windows; bound dimension lists and label accuracy/freshness honestly. Normalized snapshots carry a provider, source, schema version/fingerprint, and bounded buckets with nullable reset times. Failure must preserve last-good data as stale, not turn it into a fresh zero.

The sample fixture and adapter are in `build/fixtures/provider-sample.json` and `build/fixtures/sample-provider.mjs`. Run `npm run validate:provider`. The fixture tool rejects oversized, deeply nested, malformed, and secret-like inputs before adapter code runs. Never load plugin code or executable fixture content from a remote URL.

## Troubleshooting

If a reading stops changing, check the provider's signed-in usage page first. Open Settings > Status for source age, permissions, and redacted error codes. A provider contract can change between releases.

For support, export a redacted bundle, inspect it, and attach it with your browser and extension version. Don't share raw network captures, session cookies, or API credentials. First-run and degraded-state screenshots in the README use example data only.

[MIT license](LICENSE).
