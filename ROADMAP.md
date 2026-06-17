# Roadmap

Open work only. Completed release history belongs in `CHANGELOG.md`; rejected or deferred research decisions belong in `RESEARCH.md`.

## Existing Open Items

### P1
- [ ] P1 — Userscript in-page settings modal
  Why: The userscript currently cannot configure the product without leaving the page.
  Evidence: `userscript/entry.js` has a stubbed `openInlineSettings()` path; Tampermonkey and Violentmonkey expose GM storage/menu APIs.
  Touches: `userscript/entry.js`, `src/ui/options.js`, `src/styles/theme.css`
  Acceptance: Userscript users can change rows, theme, thresholds, notifications, and fallback behavior in an in-page modal persisted through GM storage.
  Complexity: M

- [ ] P1 — Reset cached Claude organization ID
  Why: Workspace/team switches can strand users on a stale Claude org.
  Evidence: `src/scrapers/claude.js` already caches org IDs and exposes `clearClaudeOrgCache()`.
  Touches: `src/scrapers/claude.js`, `src/background.js`, `src/ui/options.js`, `userscript/entry.js`
  Acceptance: Options diagnostics include a reset action that clears the Claude org cache and immediately refreshes usage.
  Complexity: S

- [ ] P1 — Clear and export history
  Why: Local-only history needs explicit user control before retention, migration, or pruning work lands.
  Evidence: `src/lib/history.js` stores rolling samples; OpenUsage, CodexBar, and Tokens 4 Breakfast all expose export surfaces.
  Touches: `src/lib/history.js`, `src/lib/storage.js`, `src/ui/options.js`, `userscript/entry.js`
  Acceptance: Users can export CSV and clear history behind a clear confirmation with no accidental data loss.
  Complexity: M

- [ ] P1 — WCAG 2.2 AA conformance pass
  Why: A tracker users keep open during work must be keyboard-accessible, readable, and calm under reduced-motion settings.
  Evidence: WCAG 2.2; current widget/popup/options rely on compact controls and dynamic states.
  Touches: `src/ui/widget.js`, `src/ui/popup.js`, `src/ui/options.js`, `src/styles/theme.css`, `src/styles/widget.css`
  Acceptance: Keyboard navigation, focus states, aria-live countdowns, reduced motion, touch targets, and contrast pass documented AA checks.
  Complexity: M

- [ ] P1 — High-contrast and color-blind safe palette
  Why: Rings and badges currently lean heavily on color for warning/danger meaning.
  Evidence: WCAG 2.2 non-color guidance; existing theme threshold colors in `src/ui/theme.js` and CSS.
  Touches: `src/ui/theme.js`, `src/styles/theme.css`, `src/styles/widget.css`, `src/styles/popup.css`
  Acceptance: A high-contrast option adds shape/pattern cues and preserves 4.5:1 text contrast across widget, popup, and options.
  Complexity: M

- [ ] P1 — Expand countdown, history, and notify unit coverage
  Why: Reset parsing, history trimming, and alert timing are high-trust logic that can regress silently.
  Evidence: Current tests cover helper basics, but not DST, month-end, stale sample, catch-up, or duplicate-fire edge cases.
  Touches: `build/test-cache-timer.mjs`, `build/test-history.mjs`, `build/test-notify.mjs`, `src/lib/cache-timer.js`, `src/lib/history.js`, `src/lib/notify.js`
  Acceptance: Tests cover DST, last-day-of-month, weekday rollover, late refresh, stale data, disabled rule, snooze, and duplicate-fire scenarios.
  Complexity: S

### P2
- [ ] P2 — TypeScript migration
  Why: Provider payloads are schema-drift prone and typed normalization would catch common parser mistakes earlier.
  Evidence: `src/scrapers/*.js` accept multiple private API shapes; esbuild already supports TypeScript.
  Touches: `src/**/*.js`, `build/*.mjs`, `package.json`, `tsconfig.json`
  Acceptance: Core source compiles as TypeScript with checked provider snapshot/settings/history types and no runtime behavior regression.
  Complexity: L

- [ ] P2 — README screenshots and animated product captures
  Why: The README explains features but does not prove the actual widget, popup, and options experience visually.
  Evidence: Direct competitors show screenshots/GIFs; current README relies mostly on text.
  Touches: `README.md`, release assets, screenshot workflow
  Acceptance: README shows current widget, popup dashboard, options, first-run, and degraded/error states from this product.
  Complexity: S

- [ ] P2 — README comparison table and FAQ
  Why: Users need an honest tradeoff view versus Claude Counter, Claude Usage Extension, Tokens 4 Breakfast, CodexBar, and OpenUsage.
  Evidence: `RESEARCH.md` competitive landscape; README privacy/install sections.
  Touches: `README.md`
  Acceptance: README covers data stored, permissions, revoke path, release assets, local-only limits, and competitor tradeoffs without inflated claims.
  Complexity: S

- [ ] P2 — Anthropic API-key provider path
  Why: Official Anthropic analytics endpoints are more store-safe and less schema-fragile than private web endpoints for eligible users.
  Evidence: Anthropic Enterprise Analytics API and Claude Code usage report docs.
  Touches: `src/providers`, `src/ui/options.js`, `src/ui/popup.js`, `src/lib/storage.js`
  Acceptance: Users can add an Anthropic admin/API key locally and view API usage separately from Claude Web usage.
  Complexity: L

- [ ] P2 — OpenAI API-key provider path
  Why: OpenAI's Usage and Costs APIs can provide official per-model/project/API-key data for developer spend monitoring.
  Evidence: OpenAI Usage API docs; CostGoat and OpenUsage emphasize OpenAI cost visibility.
  Touches: `src/providers`, `src/ui/options.js`, `src/ui/popup.js`, `src/lib/storage.js`
  Acceptance: Users can add an OpenAI API key locally and see usage/cost grouped by model/project/API key.
  Complexity: L

- [ ] P2 — Settings export/import JSON
  Why: Local-only users need a manual migration path across browsers and fresh installs.
  Evidence: Chrome storage sync quotas; README local-only stance; existing settings live in `aut.state.v1`.
  Touches: `src/lib/storage.js`, `src/ui/options.js`, `userscript/entry.js`
  Acceptance: Users can export/import settings without history unless explicitly selected, with schema validation and rollback on invalid imports.
  Complexity: M

- [ ] P2 — i18n string table
  Why: Locale-specific date/time/percent formatting and extractable strings are needed before adding more user-facing settings and providers.
  Evidence: CodexBar and hamed-elfayome tracker expose multi-language UX; current strings are inline across UI files.
  Touches: `src/ui/*.js`, `userscript/entry.js`, `src/lib/i18n.js`
  Acceptance: English strings are centralized and UI dates/percentages use `Intl`; at least three additional locales can be added without touching render logic.
  Complexity: M

- [ ] P2 — Multi-profile manager
  Why: Users with personal/work Claude or ChatGPT accounts need explicit profile separation without account-switch automation.
  Evidence: Existing roadmap research; multi-account tools demonstrate demand, while auto-switching remains rejected.
  Touches: `src/lib/storage.js`, `src/background.js`, `src/ui/popup.js`, `src/ui/options.js`, `userscript/entry.js`
  Acceptance: Users can create, rename, switch, and delete local profiles; each profile has isolated settings/history/provider state.
  Complexity: L

- [ ] P2 — Incognito-window separate tracking
  Why: Incognito sessions should not merge silently with normal-window usage or history.
  Evidence: Chrome extension incognito split behavior; prior roadmap item NX-08.
  Touches: `src/background.js`, `src/lib/storage.js`, `src/ui/widget.js`, manifests
  Acceptance: Incognito context uses isolated state keys and shows a visible incognito profile marker.
  Complexity: M

- [ ] P2 — chrome.storage.sync settings opt-in
  Why: Cross-device settings sync is useful, but history and credentials must stay local.
  Evidence: Chrome storage docs: `storage.sync` quotas are small and sync-specific.
  Touches: `src/lib/storage.js`, `src/ui/options.js`
  Acceptance: Users can opt in to sync non-sensitive settings only; history, tokens, provider data, and bridge config remain local.
  Complexity: M

### P3
- [ ] P3 — GitHub Copilot provider
  Why: Copilot is common in the same developer workflow as Claude/Codex tracking.
  Evidence: OpenUsage, CodexBar, Tokens 4 Breakfast, and WakaTime AI all treat Copilot as adjacent provider coverage.
  Touches: provider modules, auth settings, popup/options rows
  Acceptance: Users can authenticate locally and view Copilot quota or usage without weakening the default permission set.
  Complexity: L

- [ ] P3 — Cursor provider
  Why: Cursor usage and cost visibility appears repeatedly in adjacent commercial trackers.
  Evidence: OpenUsage, CodexBar, Tokens 4 Breakfast, TokenWatch.
  Touches: provider modules, auth settings, popup/options rows
  Acceptance: Cursor usage appears as a separate provider with source/freshness diagnostics and opt-in auth.
  Complexity: L

- [ ] P3 — Gemini provider
  Why: Gemini is part of the multi-provider developer spend set.
  Evidence: OpenUsage, CodexBar, Tokens 4 Breakfast.
  Touches: provider modules, auth settings, popup/options rows
  Acceptance: Gemini usage appears as a separate provider with local auth and no cloud relay.
  Complexity: L

- [ ] P3 — OpenRouter provider
  Why: OpenRouter is a lower-effort API-key provider that adds model-routing cost visibility.
  Evidence: OpenUsage and Tokens 4 Breakfast include OpenRouter coverage.
  Touches: provider modules, auth settings, popup/options rows
  Acceptance: Users can add an OpenRouter key locally and view credits/usage with refresh diagnostics.
  Complexity: M

- [ ] P3 — Pace marker on quota rings
  Why: Users need to know not only current usage but whether current burn rate will exceed the window.
  Evidence: Claude-Code-Usage-Monitor, Tokens 4 Breakfast, and existing burn-rate forecast.
  Touches: `src/lib/history.js`, `src/ui/widget.js`, `src/ui/popup.js`, `src/styles/widget.css`
  Acceptance: Rings show a secondary projected-use marker with accessible text and no layout shift.
  Complexity: M

- [ ] P3 — Anomaly and spike detection
  Why: Community reports show sudden quota jumps are a high-friction failure mode.
  Evidence: Anthropic/Claude Code community complaints; existing history samples.
  Touches: `src/lib/history.js`, `src/lib/notify.js`, `src/ui/options.js`
  Acceptance: A configurable alert fires when a new sample jumps beyond a tested moving-average threshold.
  Complexity: M

- [ ] P3 — API-path cost computation
  Why: Cost totals are meaningful for API-key providers but misleading for flat subscription windows.
  Evidence: OpenAI Usage/Costs API, Tokens 4 Breakfast, CostGoat, OpenUsage.
  Touches: provider modules, pricing data, `src/ui/popup.js`, `src/ui/options.js`
  Acceptance: API providers show per-model cost totals from official usage/cost endpoints or a versioned local pricing table.
  Complexity: L

- [ ] P3 — Mobile-friendly userscript build
  Why: Android userscript browsers need a lower-motion, non-drag-first layout.
  Evidence: Existing Later item; current widget is optimized for desktop pointer use.
  Touches: `userscript/entry.js`, `src/ui/widget.js`, `src/styles/widget.css`
  Acceptance: A mobile userscript mode uses stable touch targets, no drag dependency, and a compact sticky layout.
  Complexity: M

- [ ] P3 — Provider plugin API
  Why: Provider count will grow faster than core maintainers can safely ship if every provider is hard-coded.
  Evidence: CodexBar and OpenUsage provider breadth; current provider logic is centralized.
  Touches: `src/providers`, `src/background.js`, `src/lib/storage.js`, tests
  Acceptance: Providers expose documented `auth`, `fetch`, `parse`, and `normalize` contracts with fixture tests.
  Complexity: XL

- [ ] P3 — Webhook on notification rule fire
  Why: Power users may want Slack, Discord, or generic POST alerts when quota thresholds trip.
  Evidence: Existing Later item; commercial tools emphasize proactive alerts.
  Touches: `src/lib/notify.js`, `src/ui/options.js`, `src/background.js`
  Acceptance: Optional webhook delivery is disabled by default, redacts provider data by default, and is tested for retries/failure copy.
  Complexity: M

- [ ] P3 — Dollar-budget caps
  Why: Session budget alerts are a commercial differentiator once API cost data exists.
  Evidence: Tokens 4 Breakfast Focus Mode; OpenAI/Anthropic API usage cost surfaces.
  Touches: cost provider modules, `src/lib/notify.js`, `src/ui/options.js`
  Acceptance: Users can set per-session or per-day API spend caps with 80 percent and 100 percent alerts.
  Complexity: L

- [ ] P3 — Month-end bill prediction
  Why: Run-rate prediction turns raw API usage into a planning signal.
  Evidence: Tokens 4 Breakfast and CostGoat emphasize monthly spend forecasting.
  Touches: `src/lib/history.js`, cost provider modules, popup/options analytics
  Acceptance: API-key providers show a tested projected month-end cost with confidence label and assumptions.
  Complexity: L

- [ ] P3 — Plan optimization recommendations
  Why: Users need plan guidance only after usage history is accurate and exportable.
  Evidence: Tokens 4 Breakfast plan optimization; current history and forecast primitives.
  Touches: `src/lib/history.js`, popup analytics, options copy
  Acceptance: The app suggests cheaper or higher-cap plans only when data coverage is sufficient and labels uncertainty.
  Complexity: L

- [ ] P3 — Per-API-key and workspace breakdown
  Why: Official API usage endpoints support higher-resolution cost attribution.
  Evidence: OpenAI Usage API and Anthropic analytics docs.
  Touches: API provider modules, popup/options analytics, export
  Acceptance: API paths can group by workspace/project/API key without exposing secret values in UI or exports.
  Complexity: L

- [ ] P3 — MCP usage server
  Why: Claude Code and other agents could query remaining usage without a browser context switch.
  Evidence: Existing Later item; adjacent statusline and local-monitor tools show demand.
  Touches: native bridge, separate MCP package, storage export boundary
  Acceptance: A local-only MCP tool exposes `get_usage`, `forecast`, and `time_to_reset` from explicit exported state.
  Complexity: XL

- [ ] P3 — Team or collaboration dashboard
  Why: Teams need aggregate cost visibility, but this changes privacy and infrastructure assumptions.
  Evidence: WakaTime AI and TokenWatch team/client attribution models.
  Touches: optional aggregator, export schema, privacy docs, auth model
  Acceptance: Any team mode is opt-in, self-hostable or user-provided, and never uploads prompts or code.
  Complexity: XL

- [ ] P3 — Per-client, project, and git-branch attribution
  Why: Agencies need billable AI spend attribution, but it belongs after cost/API foundations.
  Evidence: TokenWatch captures cost, model, developer, project, and branch without prompt/code content.
  Touches: API provider modules, optional local Git metadata bridge, exports
  Acceptance: Attribution metadata is opt-in, redacted in diagnostics, and exportable for invoicing.
  Complexity: XL

- [ ] P3 — Native messaging companion for schedule reliability
  Why: MV3 service workers can sleep through exact notification windows.
  Evidence: Chrome service worker lifecycle docs; existing QuotaGlass bridge capability.
  Touches: native bridge, installer docs, `src/background.js`, `src/lib/notify.js`
  Acceptance: An explicit opt-in helper can wake the extension for scheduled refresh/briefing checks across supported OSes.
  Complexity: L

## Research-Driven Additions

### P0
- [ ] P0 — Release artifact and version provenance gate
  Why: Users following the README can install stale assets because documented v0.2.1 does not match the latest GitHub release.
  Evidence: `README.md`, `package.json`, `manifests/*.json`, `.github/workflows/release.yml`, `gh release list`, CodexBar/OpenUsage release assets.
  Touches: `build/build-all.mjs`, `.github/workflows/release.yml`, `package.json`, `README.md`, userscript metadata, release checklist/tests
  Acceptance: CI fails if package/manifests/userscript/README/release workflow asset names disagree; v0.2.1 release assets include Chrome ZIP, Firefox XPI, userscript, and SHA256 checksums.
  Complexity: M

- [ ] P0 — Provider-level freshness and stale-data ledger
  Why: A partial provider failure must not make preserved old data look freshly fetched.
  Evidence: `src/background.js` snapshot merge behavior; Codex issue #15281; CodexBar issue #1600; existing diagnostics.
  Touches: `src/background.js`, `src/lib/storage.js`, `src/ui/popup.js`, `src/ui/widget.js`, `src/ui/options.js`, `userscript/entry.js`, tests
  Acceptance: Each provider stores and displays `lastSuccessISO`, `lastErrorISO`, age, source, fallback source, and stale status; preserved data is visually and textually labelled stale.
  Complexity: M

- [ ] P0 — State schema migration and repair path
  Why: Settings/history shapes are evolving and the current single storage blob has no explicit upgrade or corruption recovery contract.
  Evidence: `src/lib/storage.js`, `src/ui/options.js` defensive fallbacks, Chrome storage docs.
  Touches: `src/lib/storage.js`, `src/ui/options.js`, `src/ui/popup.js`, `userscript/entry.js`, tests
  Acceptance: State includes `stateVersion`, migrations cover old shapes, corrupt state falls back to a recoverable error with export/reset options, and tests prove upgrades preserve history/settings.
  Complexity: M

- [ ] P0 — Production storage adapter hardening
  Why: The fallback adapter can write tracker state into provider-page `localStorage` if extension/GM storage is unavailable, exposing usage metadata to the host origin.
  Evidence: `src/lib/storage.js`, README local-only privacy claim, Chrome storage docs.
  Touches: `src/lib/storage.js`, test setup, userscript bootstrap, diagnostics copy
  Acceptance: `localStorage` fallback is test-only or explicit dev-only; production extension/userscript paths fail closed with a visible degraded state instead of writing to provider-origin storage.
  Complexity: S

- [ ] P0 — Page-message bridge validation
  Why: Same-page scripts can spoof the current `source`/`type` convention and poison stream/header-derived usage before it reaches history, notifications, badge, or native bridge output.
  Evidence: `src/page-interceptor.js`, `src/page-bridge.js`, `src/background.js`, Chrome content-script isolation docs, postMessage extension security research.
  Touches: `src/page-interceptor.js`, `src/page-bridge.js`, `src/background.js`, `src/lib/claude-stream.js`, tests
  Acceptance: Bridge messages validate origin, frame, nonce or equivalent capability, schema, payload size, percent/range bounds, and timestamp freshness before background ingestion.
  Complexity: M

### P1
- [ ] P1 — Missed-notification catch-up scheduler
  Why: Reset and daily briefing alerts can be missed when the browser or MV3 service worker wakes outside the current narrow windows.
  Evidence: `src/lib/notify.js`, `src/background.js`, Chrome service worker lifecycle docs.
  Touches: `src/lib/notify.js`, `src/background.js`, `build/test-notify.mjs`, options copy
  Acceptance: R1/R2/D1 rules have tested catch-up grace, duplicate-fire prevention, and next-alarm derivation after browser sleep or late refresh.
  Complexity: M

- [ ] P1 — Storage quota diagnostics and retention controls
  Why: History should stay local and useful without silently approaching browser storage limits.
  Evidence: `src/lib/history.js`, Chrome storage `getBytesInUse()` docs, OpenUsage/CodexBar/Tokens 4 Breakfast export and history surfaces.
  Touches: `src/lib/history.js`, `src/lib/storage.js`, `src/ui/options.js`, `userscript/entry.js`, tests
  Acceptance: Options show storage bytes used, retention length, compact/prune controls, export-before-prune copy, and tests for retention/downsampling behavior.
  Complexity: M

- [ ] P1 — Upgrade esbuild and add audit gate
  Why: Build tooling is affected by GHSA-67mh-4wv8-2f99 and should not ship with known vulnerable dev dependencies.
  Evidence: `package.json`, `npm audit --json`, GitHub Advisory GHSA-67mh-4wv8-2f99, esbuild releases.
  Touches: `package.json`, `package-lock.json`, CI/test scripts
  Acceptance: esbuild is upgraded to a patched/current release, `npm audit` has no actionable findings, and build/test outputs stay stable.
  Complexity: S

- [ ] P1 — Split optional native bridge permission surface
  Why: `nativeMessaging` is requested for every install even though QuotaGlass integration is optional.
  Evidence: `manifests/chrome.json`, `manifests/firefox.json`, README privacy claims, browser store permission review expectations.
  Touches: manifests, build scripts, bridge settings, README/install docs
  Acceptance: Default builds avoid bridge-only permission where feasible, or clearly separate a bridge build/channel with explicit install copy and unchanged core tracking behavior.
  Complexity: M

- [ ] P1 — Provider contract fixture matrix
  Why: Private Claude/ChatGPT schemas and DOM selectors drift, and parser breakage should fail with actionable diagnostics before users report bad numbers.
  Evidence: `src/scrapers/claude.js`, `src/scrapers/codex.js`, `build/test-scrapers.mjs`, Claude Counter issues #26/#27/#30, Codex WHAM issue #10869.
  Touches: `build/test-scrapers.mjs`, `src/scrapers/*.js`, fixture data, error classification
  Acceptance: Tests cover API, stream, header, DOM, raw HTML, auth failure, missing account, and renamed-field payloads with provider-specific error codes.
  Complexity: M

- [ ] P1 — Rendered UI and accessibility regression harness
  Why: Current tests do not render popup/options/widget state permutations where overflow, focus, copy, and contrast regressions occur.
  Evidence: `src/ui/popup.js`, `src/ui/options.js`, `src/ui/widget.js`, WCAG 2.2, existing appearance smoke test limitations.
  Touches: UI test harness, `src/ui/*.js`, CSS, CI scripts
  Acceptance: Automated checks render first-run, loading, stale, error, disabled, snoozed, and reduced-motion states for popup/options/widget and fail on console errors, missing labels, focus traps, or obvious overflow.
  Complexity: M

- [ ] P1 — Native bridge payload minimization
  Why: The optional desktop bridge currently receives the whole extension state even though the mirror only needs current usage/reset display data.
  Evidence: `src/lib/bridge.js`, `src/background.js`, README privacy claim, Chrome native messaging docs, native-messaging security research.
  Touches: `src/lib/bridge.js`, `src/background.js`, QuotaGlass schema docs/tests
  Acceptance: Bridge output is a versioned redacted envelope containing only provider, bucket, percent, reset, source, freshness, and display settings required by QuotaGlass; history, raw errors, org/account IDs, and secrets are excluded by default.
  Complexity: M

- [ ] P1 — Manifest and host matrix validator
  Why: Content scripts cover wildcard subdomains, but host permissions and web-accessible resources are apex-only; userscript metadata and runtime host checks also disagree on `openai.com`.
  Evidence: `manifests/chrome.json`, `manifests/firefox.json`, `userscript/header.txt`, `src/content.js`, `userscript/entry.js`, Chrome content-script and web-accessible resource docs.
  Touches: manifests, `userscript/header.txt`, `src/content.js`, `userscript/entry.js`, build validation
  Acceptance: A build/test step fails when content script matches, host permissions, web-accessible resource matches, userscript `@match/@connect`, README hosts, and runtime host predicates drift.
  Complexity: S

- [ ] P1 — Analytics fallback observer backpressure
  Why: The fallback scraper attaches a broad `MutationObserver` to high-churn settings pages and can keep parsing after the initial stable snapshot.
  Evidence: `src/analytics-scraper.js`, Chrome content-script performance guidance, current direct API-first fallback design.
  Touches: `src/analytics-scraper.js`, parser tests, diagnostics
  Acceptance: The observer debounces mutations, pauses when the document is hidden, disconnects or backs off after stable success, and reports fallback activity counts in diagnostics.
  Complexity: M

- [ ] P1 — Deterministic release dependency and workflow hardening
  Why: Release builds use mutable dependency/action resolution, which weakens artifact trust even after version provenance checks.
  Evidence: `.github/workflows/release.yml`, `.gitignore`, ignored `package-lock.json`, npm `ci` docs, GitHub Actions secure-use guidance.
  Touches: `.gitignore`, `package-lock.json`, `.github/workflows/release.yml`, release validation
  Acceptance: The lockfile is tracked or an explicit alternate lock strategy is documented; CI uses `npm ci`; actions are pinned or covered by an allowlist policy; release artifacts remain byte-stable for the same commit and lockfile.
  Complexity: M

- [ ] P1 — Safe DOM rendering policy
  Why: The UI uses scattered `innerHTML` writes with local escape helpers, making future dynamic copy changes easy to get wrong.
  Evidence: `src/ui/widget.js`, `src/ui/popup.js`, `src/ui/options.js`, Chrome extension CSP docs, Trusted Types docs.
  Touches: UI render helpers, CSS, CSP/report-only test harness
  Acceptance: Dynamic user/provider data is rendered through shared safe text/attribute helpers or DOM builders; any retained HTML templates are static-reviewed; a Trusted Types or equivalent unsafe-sink audit runs in CI.
  Complexity: M

- [ ] P1 — WebExtension API compatibility contract tests
  Why: The shared browser wrapper assumes both Chrome callback APIs and Firefox promise APIs behave the same for notifications, tabs, alarms, storage, and messaging.
  Evidence: `src/lib/browser.js`, `src/background.js`, MDN notification promise docs, Chrome notification/tabs callback docs.
  Touches: `src/lib/browser.js`, `src/background.js`, tests, build matrix
  Acceptance: Unit tests simulate Chrome callback style and Firefox promise style for used APIs; failures are visible before packaging Chrome/Firefox builds.
  Complexity: M

### P2
- [ ] P2 — Store-readiness disclosure matrix
  Why: Store reviewers and privacy-sensitive users need a precise explanation of permissions, host access, data storage, native messaging, and no-telemetry behavior.
  Evidence: README privacy/install sections, MDN Firefox data collection permissions, Chrome extension permission model, lugia19 privacy docs.
  Touches: `README.md`, release checklist, manifests
  Acceptance: README has a concise permission/data matrix that matches manifests and clearly separates local-only core tracking from optional bridge behavior.
  Complexity: S

- [ ] P2 — Chrome side-panel dashboard
  Why: The popup is a glance surface; long-lived diagnostics, history, and provider comparison fit better in an optional persistent panel.
  Evidence: Chrome Side Panel API docs; CodexBar/OpenUsage persistent dashboard patterns.
  Touches: `manifests/chrome.json`, new side-panel entry, shared UI rendering, CSS
  Acceptance: Chrome users can open a side panel with current usage, history, diagnostics, and settings links while the popup remains compact.
  Complexity: L

- [ ] P2 — Redacted diagnostics export bundle
  Why: Schema drift and auth failures need support evidence without leaking tokens, prompts, account IDs, org IDs, or raw cookies.
  Evidence: Existing options diagnostics, Codex issue reports, README privacy promise.
  Touches: `src/ui/options.js`, `src/lib/storage.js`, provider error types
  Acceptance: Copy/export diagnostics includes version, manifest channel, permissions, provider freshness/source/error codes, storage usage, and redacted identifiers.
  Complexity: M

- [ ] P2 — Notification permission preflight and test alert
  Why: Userscript users can lose the first important alert to a browser permission prompt because permission is requested only when a rule fires.
  Evidence: `src/lib/browser.js`, `userscript/entry.js`, README userscript notification caveat, MDN/Chrome notification APIs.
  Touches: `src/lib/browser.js`, `src/ui/options.js`, `userscript/entry.js`, README FAQ
  Acceptance: Settings show notification permission state, provide a test notification, and explain userscript tab-open requirements before alerts are needed.
  Complexity: S

- [ ] P2 — Runtime floor and browser compatibility matrix
  Why: README, build targets, manifests, and platform API choices do not share one checked compatibility floor.
  Evidence: README says Chromium 109+, build targets Chrome 111/Firefox 115, Firefox manifest has `strict_min_version`, Chrome manifest lacks `minimum_chrome_version`.
  Touches: `README.md`, `manifests/chrome.json`, `manifests/firefox.json`, build validation
  Acceptance: Supported Chrome/Firefox/userscript versions are declared in one matrix and build validation fails when a used API exceeds the documented floor.
  Complexity: S

### P3
- [ ] P3 — Claude cache-hit ratio metric
  Why: Cache timer visibility is useful, but users also need to know whether they are actually reusing cache before it expires.
  Evidence: `src/lib/cache-timer.js`, Claude stream metadata, OpenUsage cache-hit-ratio request #212, Tokens 4 Breakfast cache reuse positioning.
  Touches: `src/lib/cache-timer.js`, `src/lib/history.js`, widget/popup analytics
  Acceptance: The app records cache-window reuse events locally and shows a 24-hour/7-day cache reuse ratio with clear limitations.
  Complexity: M

- [ ] P3 — Official API provider auth boundary
  Why: Public API-key providers need a consistent secret storage, redaction, and revocation model before provider expansion scales.
  Evidence: OpenAI Usage API, Anthropic Enterprise Analytics API, README local-only claim.
  Touches: `src/lib/storage.js`, provider modules, options auth UI, diagnostics redaction
  Acceptance: API keys are stored locally, never included in diagnostics/exports, can be revoked per provider, and use a shared auth-status contract.
  Complexity: M
