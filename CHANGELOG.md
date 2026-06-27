# Changelog

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
