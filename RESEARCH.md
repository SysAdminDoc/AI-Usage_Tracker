# Research notes

This file indexes the August 8, 2026 review. Its findings describe the repository as it stood then, before the subsequent hardening changes. They aren't a current bug list or a promise about provider behavior.

The [original research](assets/concepts/2026-09-08-marketing/originals/RESEARCH.md) is preserved with its sources and dated conclusions.

## What changed afterward

The source now includes provider request bounds and freshness handling, message validation, optional API permissions, and session-first credential storage. Notification recovery and history limits have local regression coverage.

The v0.2.5 acceptance run also loads packaged extensions in isolated headless browsers. Chromium has the broader runtime and accessibility checks; Firefox checks temporary installation and its popup/settings pages.

Strict model contracts pass. Other covered JavaScript is checked against a baseline of 1,147 existing TypeScript diagnostics. This is not a fully type-clean codebase.

## Items that still need external evidence

- Normal Firefox distribution needs Mozilla signing.
- Authenticated provider behavior needs checks against accounts with the required permissions. Redacted local fixtures don't prove that a provider endpoint still behaves the same today.
- Userscript managers and the optional QuotaGlass companion need their own installed-environment acceptance.

Read the [current user guide](GUIDE.md) for supported behavior and data handling. [CHANGELOG.md](CHANGELOG.md) records implementation changes; [ROADMAP.md](ROADMAP.md) records delivery work.
