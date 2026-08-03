# Roadmap

Open work only. Completed release history belongs in `CHANGELOG.md`; rejected or deferred research decisions belong in `RESEARCH.md`.

## Existing Open Items

### P1
### P2
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

### P2
### P3
- [ ] P3 — Claude cache-hit ratio metric
  Why: Cache timer visibility is useful, but users also need to know whether they are actually reusing cache before it expires.
  Evidence: `src/lib/cache-timer.js`, Claude stream metadata, OpenUsage cache-hit-ratio request #212, Tokens 4 Breakfast cache reuse positioning.
  Touches: `src/lib/cache-timer.js`, `src/lib/history.js`, widget/popup analytics
  Acceptance: The app records cache-window reuse events locally and shows a 24-hour/7-day cache reuse ratio with clear limitations.
  Complexity: M

