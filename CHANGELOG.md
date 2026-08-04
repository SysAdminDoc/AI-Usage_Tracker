# Changelog

## Unreleased

### Added
- The userscript now detects narrow/coarse-pointer viewports, anchors a compact widget to the safe viewport edges, preserves 44px touch targets, and disables desktop dragging while in mobile mode.
- Optional webhook notification delivery now supports endpoint-origin permission requests, redacted-by-default rule events, bounded transient retries, a redacted test action, and visible failure status while remaining disabled by default.
- Optional local API spend caps now track session/day deltas for cost-bearing providers and alert at 80% and 100%, with explicit baseline/reset behavior and fixture coverage for counter resets and pricing-source changes.
- API-key providers now register through a versioned `auth` → `fetch` → `parse` → `normalize` plugin contract with a shared credential boundary, generic background dispatch, and fixture coverage for every built-in adapter.
- API analytics now follow paginated usage/cost reports, show Anthropic’s official model/workspace costs, and show OpenAI per-model pricing-table estimates beside the official organization cost reconciliation rows with visible provenance.
- Optional U3 spike alerts now compare each new quota sample with the recent moving average, with configurable percentage-point thresholds in extension and userscript settings.
- Quota rings now show a fixed-layout pace marker for projected usage at reset, with an accessible exhaustion forecast when recent history is sufficient.
- A userscript in-page settings modal for provider and quota-row visibility, refresh fallback, theme, thresholds, notifications, and daily briefing time.
- Pure settings normalization and dynamic quota-row catalog coverage for userscript controls.
- CSV export, retention selection, storage-size diagnostics, representative-sample compaction, and confirmation-gated history clearing in extension and userscript settings.
- Keyboard/live-region improvements, reduced-motion and touch-target coverage, plus an opt-in high-contrast palette with non-color warning cues.
- Default extension packages no longer request `nativeMessaging`; an explicit `npm run build:bridge` channel retains optional QuotaGlass support.
- Renewal, reset, and daily briefing notifications now recover within tested grace periods after browser or service-worker sleep, with a derived one-shot alarm for the next deadline.
- Provider API, auth, DOM, HTML, stream, and header contracts now carry stable provider-specific error codes with fixture coverage for renamed fields and fallback surfaces.
- An isolated linkedom regression harness now renders popup, widget, and options state permutations and checks labels, busy/focus hooks, reduced motion, and overflow guards without opening a browser window.
- A canonical two-provider host matrix now validates extension matches, apex permissions, web-accessible resources, userscript metadata, README hosts, and runtime predicates during tests and builds.
- UI rendering now uses shared text/attribute/DOM builders; the CI safety audit rejects direct HTML sinks and guards the single reviewed static icon template.
- A shared WebExtension adapter now normalizes Chrome callback APIs and Firefox promise APIs for notifications, tabs, alarms, storage, and messaging, with runtime contract fixtures for both styles.
- README now includes a manifest-matched permission/data matrix, local-data revoke path, comparison table, and FAQ covering privacy and degraded states.
- Settings now preflight notification capability and offer a permission request plus test alert in both the extension page and userscript modal.
- Browser support is now declared as Chromium 111+ and Firefox 115+ in one checked runtime matrix; Chrome manifests and README installation guidance carry the same floor.
- Status now exports/copies a versioned redacted diagnostics bundle with permissions, provider freshness/source/error codes, storage usage, and shortened identifiers while omitting history and raw errors.
- Chrome 114+ packages now include an optional persistent side-panel dashboard with the current quota view, local diagnostics, and a full-settings link; Firefox and userscript packages remain unchanged.
- A strict TypeScript model boundary now checks provider snapshots, settings, history samples, and storage state guards before tests and builds without changing the existing esbuild runtime shape.
- Dashboard status strings now use a centralized locale table with English fallback, Spanish/French/German entries, a persisted language setting, and `Intl` formatting for percentages and dates.
- Optional official Anthropic and OpenAI API provider paths now keep admin keys in a separate local-only store, normalize token/cost reports into metric rows, and redact credentials from settings/diagnostics exports.
- Local profile management now supports create, rename, switch, and delete flows with isolated settings, snapshots, history, and API credentials across the extension settings page and userscript modal.
- Chromium split-incognito windows now use separate prefixed profile/state/credential keys and expose an Incognito marker; the Firefox package fails closed with private-window access disabled.
- Settings now offer an explicit browser-sync opt-in with a versioned allowlist limited to non-sensitive preferences; history, provider snapshots, credentials, and bridge data stay local.
- Optional GitHub Copilot provider support now stores a token locally and shows official organization-member seat activity with an explicit organization/username configuration.
- Optional Cursor provider support now stores a team admin API key locally and shows official daily request totals, current-cycle spend, and source/freshness diagnostics.
- Optional Gemini provider support now stores a local Google Cloud monitoring OAuth token and project ID, then shows official output-token and request-quota usage without relaying prompts or generated content.
- Optional OpenRouter provider support now stores a key locally and shows official key usage/limits plus account credits when available.
- README now includes current widget, popup, settings, first-run, degraded-state, and animated product captures.

### Fixed
- Userscript widget callbacks now survive periodic rerenders, keeping refresh and settings actions available throughout the tab session.

## v0.2.2 - 2026-06-27 - Release hardening

### Added
- Local release provenance validation covering package, lockfile, manifests, userscript metadata, README asset names, changelog, and disallowed workflow files.
- SHA256 checksum generation for Chrome ZIP, Firefox XPI, and userscript release artifacts.

### Changed
- Full builds now clean stale artifacts before packaging and run the provenance gate before producing release assets.
- `package-lock.json` is tracked for deterministic local builds.

## v0.2.1 — 2026-06-16 — Premium UI polish

### Added
- Widget right-click menu with notification snooze/resume, hide-for-session, refresh, analytics, and settings actions.
- Manual theme selection with Mocha dark, Latte light, and system-following modes.
- Configurable visual warn/danger thresholds shared by widget rings, popup rings, and the toolbar badge.
- Options-page notification snooze status and controls.
- Appearance smoke coverage for shared threshold behavior.

### Changed
- Refined popup hierarchy with a most-constrained quota overview, clearer local-only trust signal, and stronger empty-state action hierarchy.
- Reworked settings into a compact sectioned control surface with navigation, tighter spacing, clearer diagnostics, and responsive mobile collapse.
- Polished menu, focus, hover, disabled, status, and feedback states across shared UI primitives.
- Userscript widget usage-page actions now fall back to direct `window.open()` when extension messaging is unavailable.

## v0.2.0 — 2026-05-25 — QuotaGlass desktop bridge

Optional integration with [QuotaGlass](https://github.com/SysAdminDoc/QuotaGlass), a Windows desktop widget that displays Claude + Codex quota state on your desktop. The extension forwards every successful state ingest to the QuotaGlass native messaging host. If QuotaGlass is not installed, the bridge is a silent no-op — no behavioral change for existing users beyond the new permission prompt.

### Added
- `src/lib/bridge.js` — persistent native-messaging port (`com.sysadmindoc.quotaglass`) with reconnect-on-disconnect + 25s keepalive ping. Schema documented at [QuotaGlass/docs/extension-integration.md](https://github.com/SysAdminDoc/QuotaGlass/blob/main/docs/extension-integration.md).
- `manifests/chrome.json` — added stable `"key"` field (deterministic extension ID `olkdpcileldmdemjbiklkhompnhkhjeh`).
- Both manifests — added `"nativeMessaging"` permission.
- `background.js` — `pushSnapshot` invoked after `mergeSnapshot`.
- Toolbar badge showing the most-constrained visible bucket's percent used, with green/amber/red badge and action-icon state.
- Claude widget context counter estimating the visible conversation and draft prompt against the 200k context window.
- Claude cache timer showing the five-minute cheaper-follow-up window after streamed `message_limit` events.
- Popup sparkline tooltips with exact historical usage values and sample timestamps.

### Changed
- Silent analytics-page tab refresh is now disabled by default and exposed as an opt-in fallback in Settings; API refresh remains primary, with manual usage-page buttons unchanged.

### Notes
- Existing developer-mode installs will get a new extension ID after pulling v0.2.0; reload via `chrome://extensions/`.
- The bridge sends nothing if QuotaGlass is not registered as a native messaging host. No data leaves your machine beyond the local stdin/stdout pipe.

## v0.1.6 — 2026-05-19

Adds Anthropic unified rate-limit response header capture as another Claude usage source when the browser page can read those headers.

### Added
- The Claude page-context interceptor now reads `anthropic-ratelimit-unified-*-utilization`, `-reset`, and `-status` response headers.
- Header-derived 5h and 7d utilization values merge into the same Claude local snapshot path as stream and API data.
- Widget, popup, and options diagnostics now label header-derived Claude readings distinctly.
- Parser smoke coverage now verifies unified rate-limit header normalization.

## v0.1.5 — 2026-05-19

Adds Claude streamed `message_limit` capture so usage bars can update from live completion responses instead of waiting for the rounded usage endpoint.

### Added
- Added a Claude page-context stream interceptor for completion SSE responses that extracts `message_limit` payloads without consuming the page's own response stream.
- Extension builds now bridge streamed Claude usage from the page world back to local storage through a document-start content bridge.
- Userscript builds now install the same Claude stream interceptor at document start and merge streamed rows into the existing local snapshot.
- Parser smoke coverage now verifies streamed `message_limit` SSE frames and fractional utilization values.

### Fixed
- Widget, popup, and options visible version labels now stay synchronized with the packaged project version.

## v0.1.4 — 2026-05-19

Fixes Codex usage collection by switching Codex to the ChatGPT WHAM usage API first, with the analytics-page scraper retained as fallback.

### Fixed
- Codex now reads `GET https://chatgpt.com/backend-api/wham/usage` using the logged-in ChatGPT session bearer token and `ChatGPT-Account-Id` header when available.
- Codex usage normalization supports `rate_limit.primary_window`, `rate_limit.secondary_window`, `additional_rate_limits`, and alternate `five_hour` / `weekly` field names.
- The Codex analytics DOM scraper remains as the fallback path for schema drift, logged-out sessions, or transient API failures.
- Parser smoke coverage now verifies Codex WHAM payloads, alternate field names, and auth/header construction.

## v0.1.3 — 2026-05-19

Premium polish pass across the widget, popup, and settings surfaces.

### Changed
- Moved shared brand mark, icon button, link button, focus, and motion primitives into the shared theme so popup/options no longer depend on widget-only CSS classes.
- Refined widget and popup first-run, degraded, missing-reset, refresh-loading, source-label, and error states.
- Added settings diagnostics with provider status, snapshot freshness, collection source, discovered row count, and copyable diagnostics.
- Improved responsiveness, focus-visible treatment, disabled states, reduced-motion handling, and small-screen layout behavior.
- Removed expensive content-script backdrop blur while preserving the dark elevated surface language.

## v0.1.2 — 2026-05-19

Fixes Claude usage by switching the Claude collector to the same JSON API path used by Claude Ultimate Enhancer.

### Fixed
- Claude now discovers the active organization through `GET https://claude.ai/api/organizations`, caches the org ID for the session, and reads actual usage from `GET https://claude.ai/api/organizations/{orgId}/usage`.
- Claude usage normalization now supports API percent values, streamed fractional `message_limit.windows` payloads, ISO resets, and Unix reset timestamps.
- The settings-page DOM scraper remains as a fallback instead of the primary Claude data source.
- Userscript refreshes now preserve the last successful provider snapshot when one side temporarily fails.

## v0.1.1 — 2026-05-14

Fixes the "Unable to read analytics" failure on both providers.

### Fixed
- claude.ai and chatgpt.com both serve a hydration shell on first fetch, so the background's direct `fetch()` couldn't see usage numbers — they only render after React hydrates. New `analytics-scraper.js` content script runs on the actual analytics pages, watches the rendered DOM with `MutationObserver`, and pushes the live snapshot to the background. Direct-fetch stays as a best-effort fast path.
- Background alarm now also opens a silent inactive tab (auto-closed after 20 s) for any provider whose cached data is stale. The content script on that tab does the live scrape.
- Widget empty / error states now show a one-click "Open analytics" button that opens the page so the scraper can run.

### Added
- `parseClaudeDoc(document)` and `parseCodexDoc(document)` — DOM-based scrapers that complement the regex-based raw-HTML scrapers.
- `tabs` permission in both manifests so the background can open the analytics pages.

## v0.1.0 — 2026-05-14

Initial release.

### Added
- Chrome MV3 extension (Chromium: Chrome / Edge / Brave).
- Firefox MV3 extension (Developer Edition / Nightly — unsigned XPI).
- Tampermonkey / Violentmonkey userscript (in-page widget + best-effort parity).
- Floating glass widget on claude.ai and chatgpt.com — radial-ring countdowns with HH:MM:SS centers, green/amber/red color ramp.
- Toolbar popup dashboard — both providers side-by-side, recent-usage sparklines.
- Settings page — refresh interval, per-row visibility toggles, notification rule toggles, widget position + minimized state.
- Notification rules — renewal-imminent (60 / 15 / 0 min), on-reset positive, usage thresholds (75 / 90 / 95%), burn-rate forecast, daily 08:00 briefing.
- 30-day rolling history per bucket; weekly burn-rate forecast.
- Direct authenticated `fetch()` against Codex Analytics and Claude usage endpoints; silent-tab fallback if the response is a hydration shell.
- Single source tree with three build targets (chrome.zip + crx, firefox.xpi, ai-usage-tracker.user.js).
