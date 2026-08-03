# Roadmap

Open work only. Completed release history belongs in `CHANGELOG.md`; rejected or deferred research decisions belong in `RESEARCH.md`.

## Existing Open Items

### P1
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

### P1
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

- [ ] P1 — Manifest and host matrix validator
  Why: Content scripts cover wildcard subdomains, but host permissions and web-accessible resources are apex-only; userscript metadata and runtime host checks also disagree on `openai.com`.
  Evidence: `manifests/chrome.json`, `manifests/firefox.json`, `userscript/header.txt`, `src/content.js`, `userscript/entry.js`, Chrome content-script and web-accessible resource docs.
  Touches: manifests, `userscript/header.txt`, `src/content.js`, `userscript/entry.js`, build validation
  Acceptance: A build/test step fails when content script matches, host permissions, web-accessible resource matches, userscript `@match/@connect`, README hosts, and runtime host predicates drift.
  Complexity: S

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
