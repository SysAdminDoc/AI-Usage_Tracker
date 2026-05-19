# Changelog

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
