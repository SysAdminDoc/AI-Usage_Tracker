# Research - AI Usage Tracker

## Executive Summary
AI Usage Tracker is a browser-first, local-only usage monitor for Claude and ChatGPT/Codex with Chrome MV3, Firefox MV3, and userscript builds. Its strongest current shape is the restrained, auditable extension model: no server, narrow host permissions, direct same-origin usage fetches, fallback scraping, local history, notifications, and privacy-forward README positioning. The highest-value direction is not a broad rewrite; it is making the existing tracker harder to mislead or break: ship release/version provenance, provider-level freshness, state migrations and recovery, missed-notification catch-up, storage quota controls, dependency hardening, permission minimization for the native bridge, contract fixtures for provider schema drift, and automated UI/accessibility regression coverage before expanding providers.

Top opportunities in priority order:
- [Verified] Release artifact/version provenance: README/package/manifests advertise v0.2.1, while the latest GitHub release is v0.1.5 and `.github/workflows/release.yml` still has stale release defaults.
- [Verified] Provider freshness ledger: `src/background.js` preserves old provider rows during partial failures but stores a snapshot-level freshness value, so stale provider data can look current.
- [Verified] State migration and repair: `src/lib/storage.js` uses one `aut.state.v1` blob with defaults but no explicit `stateVersion`, migration table, corruption repair path, or old-state tests.
- [Verified] Notification catch-up: `src/lib/notify.js` has narrow reset/daily windows that can be missed when the MV3 service worker sleeps or refreshes late.
- [Verified] Storage quota and retention: `src/lib/history.js` keeps a fixed 30-day sample list without storage-size diagnostics, compaction, retention settings, or export-before-prune flow.
- [Verified] Dependency hardening: `npm audit` flags `esbuild <=0.24.2` via GHSA-67mh-4wv8-2f99; the repo is on `^0.23.0`.
- [Verified] Permission minimization: `nativeMessaging` is always requested in `manifests/*.json` even though the QuotaGlass bridge is optional.
- [Verified] Userscript parity: `userscript/entry.js` still has a stubbed inline settings path; Tampermonkey and Violentmonkey provide menu/storage APIs that can close the gap without new dependencies.
- [Likely] Multi-provider/API expansion should wait until the reliability layer lands; OpenUsage, CodexBar, Tokens 4 Breakfast, and WakaTime show the market value, but this repo's trust story depends on local, auditable browser behavior.

Second-pass misses now added:
- [Verified] Production storage fallback risk: `src/lib/storage.js` falls back to page `localStorage`; outside tests that could place usage/account metadata in claude.ai/chatgpt.com origin storage readable by the host page.
- [Verified] Page bridge trust boundary: `src/page-bridge.js` accepts same-window `postMessage` payloads by `source`/`type` only, without origin, nonce, size, or schema bounds before forwarding to the privileged background path.
- [Verified] Native bridge minimization: `src/lib/bridge.js` forwards the whole extension state to QuotaGlass, including history/settings/provider metadata, instead of a minimal redacted envelope.
- [Verified] Manifest parity gap: content scripts match wildcard subdomains, while host permissions and web-accessible CSS/icon resources are apex-only; widget CSS fetches can fail if wildcard matches are ever used.
- [Verified] Analytics fallback backpressure: `src/analytics-scraper.js` installs a broad `MutationObserver` on high-churn analytics pages with no disconnect, visibility pause, or debounce beyond the in-flight guard.
- [Verified] Deterministic release gap: `.github/workflows/release.yml` uses `npm install`, actions are tag-pinned, and `package-lock.json` is ignored, so release artifacts are not reproducible from a committed dependency graph.

## Product Map
Core workflows:
- Monitor Claude and ChatGPT/Codex quota windows in a floating page widget, toolbar popup, and badge.
- Refresh usage through direct same-origin JSON fetches, streamed/header interception, and optional silent-tab fallback.
- Configure visible rows, theme, warning thresholds, notification rules, snooze, fallback behavior, and optional QuotaGlass native bridge.
- Review recent usage history, forecasts, degraded states, diagnostics, and reset/cache/context timers.
- Install as Chrome ZIP, Firefox XPI, or Tampermonkey/Violentmonkey userscript from GitHub release assets.

User personas:
- [Verified] Individual AI-heavy developers who need a visible runway before Claude/Codex caps interrupt work.
- [Verified] Privacy-sensitive users who prefer local browser storage and readable source over cloud analytics.
- [Likely] Power users who run multiple AI tools and will eventually want API-provider, profile, export, and budget surfaces.
- [Likely] Maintainers/supporters who need diagnostics when Claude or ChatGPT private schemas drift.

Platforms and distribution:
- [Verified] Chrome MV3 extension, Firefox MV3 extension, and userscript builds generated by `build/build-all.mjs`.
- [Verified] Source is MIT, unminified, ES modules plus esbuild, Node >=20, and no framework.
- [Verified] Chrome/Firefox manifests request `storage`, `alarms`, `notifications`, `tabs`, `nativeMessaging`, and host access for `https://claude.ai/*` and `https://chatgpt.com/*`.
- [Verified] GitHub release distribution is currently inconsistent with the documented version.

Key integrations and data flows:
- [Verified] Claude: `/api/organizations`, `/api/organizations/{orgId}/usage`, DOM/raw HTML fallback, streamed `message_limit`, and rate-limit header capture.
- [Verified] ChatGPT/Codex: `/api/auth/session` for token/account, then `/backend-api/wham/usage`, with DOM/raw HTML fallback.
- [Verified] Storage: `chrome.storage.local`/GM storage for snapshot, settings, notifications, and history.
- [Verified] Optional bridge: Chrome native messaging to `ai_usage_tracker.quotaglass`.

## Competitive Landscape
Claude Counter (`she-llac/claude-counter`):
- Does well: minimal extension/userscript surface, Claude API usage bars, reset countdowns, cache timer, and streamed `message_limit` for exact utilization.
- Learn: keep API/stream parsing tight and test it as a contract; lightweight UX can win when the numbers are trusted.
- Avoid: over-relying on page selectors or cookies without visible diagnostics; its open issues show schema and selector drift is a recurring maintenance cost.

Claude Usage Extension (`lugia19/Claude-Usage-Extension`):
- Does well: broad Claude accounting, Chrome/Firefox/desktop distribution, tokenizer/API-based estimates, privacy documentation, and store-ready packaging.
- Learn: privacy/store materials and cross-platform packaging are part of trust, not afterthoughts.
- Avoid: Firebase/cloud sync and prompt-adjacent token estimation conflict with this repo's "nothing leaves your browser" and quota-window focus.

CodexBar:
- Does well: multi-provider status, provider toggles, reset countdowns, status badges, release assets with checksums/digests, and rich diagnostics for stale cached data.
- Learn: provider-level status/freshness and signed/checksummed release discipline are table-stakes once users trust the app during active work.
- Avoid: a desktop/menu-bar rewrite unless the browser-first surface stops meeting user needs.

OpenUsage:
- Does well: many provider integrations, local SQLite dashboard, spend/quotas/burn rate, CSV/JSON export, Prometheus, and release checksums/signing metadata.
- Learn: exportability, retention, local persistence, and provider contracts matter before broad provider count.
- Avoid: local daemon complexity for the current browser extension unless provider/API expansion demands it.

Claude-Code-Usage-Monitor:
- Does well: forecasting, burn-rate analytics, plan detection, WCAG-aware terminal UI, extensive tests, logs, and optional error reporting.
- Learn: prediction and alert quality should be backed by tests and confidence, not just visual rings.
- Avoid: optional telemetry/Sentry unless the project intentionally changes the README privacy promise.

Tokens 4 Breakfast / TokenWatch / WakaTime AI:
- Do well: budget guardrails, morning digests, project/client attribution, subscription totals, export, and cost intelligence.
- Learn: what commercial products paywall points to future value: forecasting, exports, attribution, budget caps, and provider aggregation.
- Avoid: cloud/team attribution in the default product; it creates a materially different privacy and support model.

OpenAI Codex issue/discussion ecosystem:
- Does well: exposes real pain points around stale/incomplete status, `/backend-api/wham/usage` polling, 5-hour/weekly visibility, and local quota tools.
- Learn: stale data must be labelled; users compare tracker output against first-party status and will report confidence loss quickly.
- Avoid: background pollers that run without active credentials/provider need; Codex issue #10869 shows unguarded polling is itself a bug class.

## Security, Privacy, and Reliability
Bugs or risks found:
- [Verified] `README.md`, `package.json`, `manifests/chrome.json`, and `manifests/firefox.json` claim v0.2.1, but GitHub releases stop at v0.1.5; users following README install guidance may not get the current code.
- [Verified] `.github/workflows/release.yml` uses stale manual release defaults, increasing the chance of mismatched package names, update URLs, or changelog text.
- [Verified] `src/background.js` merges partial provider snapshots, but global freshness can hide stale provider rows after a provider-specific fetch failure.
- [Verified] `src/lib/storage.js` lacks explicit migrations, state repair, and schema-version tests for users upgrading across settings/history shape changes.
- [Verified] `src/lib/notify.js` can miss reset/daily events when refresh occurs outside a narrow window; Chrome MV3 service workers are explicitly transient.
- [Verified] `src/lib/history.js` does not monitor `chrome.storage.local.getBytesInUse()` or expose history retention/compaction controls.
- [Verified] `package.json` pins vulnerable dev tooling through `esbuild ^0.23.0`; `npm audit --omit=dev` is clean, but build tooling should still be upgraded.
- [Verified] `manifests/*.json` always request `nativeMessaging`; this raises install-warning and store-review surface for an optional bridge.
- [Verified] `userscript/entry.js` routes settings to a GitHub page instead of a real in-page settings modal.
- [Verified] `src/lib/storage.js` uses a page `localStorage` fallback after WebExtension/GM adapters; in production that would expose tracker state to the provider origin rather than extension/userscript storage.
- [Verified] `src/page-interceptor.js` and `src/page-bridge.js` bridge page-context data through `window.postMessage`; the bridge lacks explicit `event.origin`, nonce, payload-size, and value-range validation before background ingestion.
- [Verified] `src/lib/bridge.js` sends `state` wholesale to the native host; this is broader than the README's local-only trust story needs for an optional desktop mirror.
- [Verified] `manifests/chrome.json` and `manifests/firefox.json` inject on `https://*.claude.ai/*` and `https://*.chatgpt.com/*`, but `host_permissions` and `web_accessible_resources.matches` include only apex origins.
- [Verified] `src/analytics-scraper.js` leaves a broad document-level `MutationObserver` active after the 30-second polling window and calls the scrape path on every observed mutation.
- [Verified] UI code uses many localized `innerHTML` writes in `src/ui/widget.js`, `src/ui/popup.js`, and `src/ui/options.js`; most dynamic values are escaped, but there is no central safe-rendering policy or Trusted Types/CSP report-only pass.
- [Verified] `.github/workflows/release.yml` uses `npm install`, `actions/checkout@v4`, and `actions/setup-node@v4` while `package-lock.json` is ignored; release dependencies and actions are not pinned for reproducible artifact builds.
- [Verified] `src/lib/browser.js` claims to bridge Chrome callbacks and Firefox promise APIs, but no test harness simulates real WebExtension API shape differences for notifications, tabs, alarms, or runtime messaging.
- [Verified] Userscript notifications request Web Notification permission only when a rule tries to fire, which can turn the first important alert into a browser permission prompt instead of a delivered notification.

Missing guardrails:
- [Verified] No release gate proves `package.json`, extension manifests, userscript metadata, release workflow inputs, README version text, and built asset names are synchronized.
- [Verified] No provider-level state model records `lastSuccessISO`, `lastErrorISO`, data source, fallback source, and staleness independently for Claude and Codex.
- [Verified] No corruption recovery UI exists when local storage cannot be parsed or migrated.
- [Verified] No automated DOM UI harness renders popup/options/widget states for overflow, focusability, reduced motion, contrast, and empty/error copy.
- [Verified] No provider contract matrix exercises representative API, stream, header, DOM, and failure payload variants from Claude and ChatGPT/Codex.
- [Verified] No production guard prevents the localStorage storage adapter from being used on provider origins.
- [Verified] No manifest matrix test proves content script matches, host permissions, web-accessible resource matches, userscript `@match`, and runtime host predicates are aligned.
- [Verified] No threat-model test covers page-script spoofing of stream/header bridge messages or poisoned values reaching history, notifications, badge state, or native bridge output.
- [Verified] No release reproducibility gate uses a committed lockfile, `npm ci`, pinned GitHub Actions, and deterministic checksum generation.
- [Verified] No notification permission preflight/test notification flow exists for userscript users.

Recovery and rollback needs:
- [Verified] Add export-before-clear/prune for history and settings; the current clear/export roadmap item should be implemented with data-loss confirmation.
- [Verified] Add one-click reset for cached Claude org ID using the existing `clearClaudeOrgCache()` path.
- [Likely] Keep last-good provider data visible only with explicit stale age/source labels and a manual refresh action.

## Architecture Assessment
Module or boundary improvements needed:
- [Verified] Split normalized provider state from global snapshot metadata in `src/background.js`, `src/lib/storage.js`, `src/ui/popup.js`, `src/ui/widget.js`, and `userscript/entry.js`.
- [Verified] Add a storage migration module around `defaultState`, `loadState`, and `saveState` rather than allowing every UI surface to defensively patch missing settings.
- [Verified] Convert notification evaluation into a scheduler-friendly model that stores last-fired and last-eligible timestamps, then tests catch-up behavior independently from UI.
- [Verified] Introduce a provider-contract test directory for Claude and Codex fixtures so endpoint/schema changes fail with actionable parser errors.
- [Verified] Add a storage adapter boundary that can be explicitly set to test-only `localStorage`, rather than falling through silently in production.
- [Verified] Add a manifest/build validation module that compares content script matches, host permissions, web-accessible resource matches, userscript metadata, and runtime host allowlists.
- [Verified] Add a page-message ingestion boundary with explicit validation before `aut/claude-message-limit`, `aut/claude-rate-limit-headers`, and `aut/scraped` messages update state.
- [Verified] Add a native bridge envelope module that serializes only the fields the desktop mirror needs.
- [Likely] Keep the native bridge isolated behind a build/profile boundary; the optional bridge should not shape the permission story for users who never install QuotaGlass.

Refactor candidates:
- [Verified] `src/background.js`: provider merge/freshness, alarm scheduling, native bridge lifecycle, and refresh/error classification are concentrated in one file.
- [Verified] `src/lib/storage.js`: add schema versioning, migration, settings validation, and history/settings export helpers.
- [Verified] `src/lib/notify.js`: add missed-event catch-up, grace windows, and schedule derivation tests.
- [Verified] `src/lib/history.js`: add storage quota telemetry, retention policy, and downsampling boundaries.
- [Verified] `src/ui/options.js` and `src/ui/popup.js`: diagnostics, destructive confirmations, export/import, and accessibility states should share smaller rendering helpers.
- [Verified] `userscript/entry.js`: inline settings, manager menu commands, and cross-tab GM storage sync are currently underbuilt compared with the extension path.
- [Verified] `src/page-bridge.js` and `src/page-interceptor.js`: add bridge authentication/validation or collapse to a more constrained event path.
- [Verified] `src/lib/bridge.js`: replace whole-state forwarding with a minimal, versioned, redacted snapshot schema.
- [Verified] `src/analytics-scraper.js`: add observer lifecycle/backpressure and visibility-aware pause/resume.
- [Verified] `.github/workflows/release.yml` and `.gitignore`: decide lockfile tracking, switch release builds to `npm ci`, and pin actions.
- [Verified] `manifests/*.json`, `userscript/header.txt`, and `src/content.js`/`userscript/entry.js`: validate the supported host matrix in one place.

Test and documentation gaps:
- [Verified] `npm test` covers parsers and helper libraries, but not rendered popup/options/widget flows across first-run, loading, stale, error, disabled, and reduced-motion states.
- [Verified] Release packaging is not asserted against live GitHub release state, checksums, or userscript update/download URLs.
- [Verified] README privacy language is strong, but store-readiness disclosures for `nativeMessaging`, data collection, and browser permissions are not yet structured enough for Chrome Web Store/AMO review.
- [Likely] API-provider expansion will need a documented auth/secret boundary before OpenAI, Anthropic Admin, Copilot, Cursor, Gemini, or OpenRouter keys are accepted.
- [Verified] Browser-specific API behavior is untested; Firefox promise-returning WebExtension APIs and Chrome callback APIs should be contract-tested instead of assumed by `src/lib/browser.js`.
- [Verified] Store/readability posture is strong because builds are unminified, but there is no automated check that release bundles remain readable and contain no remote-hosted code, obfuscated blobs, or accidental source maps.

## Rejected Ideas
- Cloud sync/Firebase usage history - source: lugia19/Claude-Usage-Extension. Reason: contradicts README's local-only/no telemetry promise.
- Automatic account switching to work around limits - source: Claude multi-account tools and existing roadmap research. Reason: ToS and trust risk; not a usage tracker responsibility.
- Standalone desktop rewrite as the next step - source: CodexBar, Tokens 4 Breakfast, TokenWatch. Reason: duplicates mature desktop products and weakens the browser-first design without fixing current reliability gaps.
- Offscreen-document replacement for authenticated provider pages - source: Chrome Offscreen API. Reason: useful for extension DOM APIs but not proven to solve authenticated claude.ai/chatgpt.com access better than direct fetch plus explicit fallback.
- Prompt/content token injection accounting for Claude Web - source: lugia19 and tokenizer-based trackers. Reason: expands into prompt-content analysis and conflicts with this project's quota-window mission.
- Default telemetry/Sentry error reporting - source: Claude-Code-Usage-Monitor. Reason: even opt-in telemetry changes the privacy story and adds infrastructure.
- New policy markdown files during this pass - source: repo/user file-hygiene rules. Reason: this pass is limited to `RESEARCH.md` and `ROADMAP.md`; policy work should update allowed docs in a later implementation pass.
- Hard request blocking at 100 percent usage - source: Chrome declarativeNetRequest API. Reason: a false positive would directly disrupt user work; warning and explicit user choice should come first.
- Broad `<all_urls>` or `cookies` permission expansion - source: Chrome permission guidance. Reason: current narrow host access is a product trust asset; add runtime permission UX only for providers that truly need it.
- Generic native bridge command channel - source: native-messaging security research. Reason: the bridge should remain one-way/minimal for display data, not a privileged command proxy from page-origin messages to local processes.
- Production page `localStorage` fallback - source: `src/lib/storage.js`. Reason: acceptable for tests only; production state belongs in extension/GM storage so provider pages cannot inspect tracker data.

## Sources
Direct OSS:
- https://github.com/she-llac/claude-counter
- https://github.com/lugia19/Claude-Usage-Extension
- https://github.com/steipete/CodexBar
- https://github.com/janekbaraniewski/openusage
- https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
- https://github.com/openai/codex/issues/15281
- https://github.com/openai/codex/issues/10869
- https://github.com/openai/codex/discussions/19303

Commercial and adjacent:
- https://www.tokens4breakfast.app/
- https://www.tokenwatch.one/
- https://wakatime.com/ai

Standards, platform, and dependency docs:
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
- https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- https://developer.chrome.com/docs/webstore/program-policies/code-readability
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/notifications/create
- https://www.tampermonkey.net/documentation.php?locale=en
- https://www.w3.org/TR/WCAG22/
- https://www.w3.org/TR/trusted-types/
- https://platform.openai.com/docs/api-reference/usage
- https://support.claude.com/en/articles/13703965-claude-enterprise-analytics-api-reference-guide
- https://github.com/advisories/GHSA-67mh-4wv8-2f99
- https://docs.npmjs.com/cli/v9/commands/npm-ci/
- https://docs.github.com/en/actions/reference/security/secure-use

Community signal:
- https://spaceraccoon.dev/universal-code-execution-browser-extensions/

## Open Questions
- [Needs live validation] Is the project intended for Chrome Web Store and AMO submission, or only GitHub ZIP/XPI distribution?
- [Needs live validation] Should QuotaGlass remain part of the default extension permission set, or should bridge support move to a separate build/channel?
- [Needs live validation] Are private Claude/ChatGPT web endpoints acceptable for the intended store/distribution channel, or should public API-key providers become the store-safe path?
- [Needs live validation] Are wildcard Claude/ChatGPT subdomains intentionally supported, or should manifests/userscript/runtime checks be narrowed to apex hosts?
- [Needs live validation] Does QuotaGlass need full local history/settings, or only current redacted usage buckets and reset times?
