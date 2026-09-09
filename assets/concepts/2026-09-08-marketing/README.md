# AI Usage Tracker marketing concepts

Review for v0.2.5, September 8, 2026. The [current README](../../../README.md) and [user guide](../../../GUIDE.md) are the active documentation. Files here preserve the review trail.

## Selected identity

Keep the existing mauve/cyan quota ring and dark rounded tile. The ring reads at toolbar size and matches the dashboard. Smoother curves and consistent borders improve the existing identity without adding decoration.

[Compare original and selected exports](icon-comparison.png) on light and dark backgrounds at 16, 32, 48, and 128 CSS pixels. The [editable comparison](icon-comparison.html), [selected exports and generator](selected/), and [1024px master](../../brand/icon-1024.png) are saved here.

The PNG corners have real alpha transparency. The dark tile inside the mark is intentional.

## Screenshots

The selected images come from the final Chrome ZIP installed in owned headless Chromium profiles. Local example data is used throughout. These are the packaged interfaces, not drawings of an interface.

- [Dashboard](captures/iteration-03/popup-dashboard.png) is the README's main product view.
- [Settings](captures/iteration-03/options-overview-ready.png) shows local profiles and provider controls after initialization.
- [Widget](captures/iteration-03/widget-dashboard.png) shows the real content script on a blank local fixture page, not the live Claude website.
- [Light theme](captures/iteration-03/popup-light.png), [first run](captures/iteration-03/popup-first-run.png), [unavailable provider](captures/iteration-03/popup-degraded.png), and [side panel](captures/iteration-03/sidepanel-dashboard.png) cover alternate states.

All capture attempts are retained. Iteration 1 used an incorrect history timestamp type, so its sparklines were empty. Iteration 2 exposed a crowded widget header and included fixture text in the widget crop. That widget image was rejected. Iteration 3 uses the repaired header. Its first settings image caught a loading message; the ready-state capture is selected.

No live credentials or private account readings were used. The browser was isolated from the active desktop.

## Preserved work

[Originals](originals/) contains the previous README, changelog, research notes, icon generator, four icon exports, and six screenshot/GIF assets. They are historical records, not current product claims.

[README draft](drafts/README.md) and [guide draft](drafts/GUIDE.md) preserve the earlier writing pass. Their relative links assume the repository root. Some guidance changed before release, including the native installer's removal dry-run. Use the current guide.

[Review record](review.json) lists the selected images and original-file hashes. The native generator remains the source for future exports; no separate image-generation brief is needed for this identity.

[README review captures](readme-review/) preserve desktop dark/light, narrow-screen, and settings-section checks. They use GitHub's Markdown renderer with a local review stylesheet, not a capture of the live repository page.

## Acceptance limits

Local tests, package signatures, and isolated browser checks passed. Chromium has the fuller runtime coverage; Firefox received temporary-install and popup/settings checks, not a normal signed installation.

Mozilla signing remains pending. Unsigned Firefox development files are excluded from the public release assets. Authenticated provider accounts, installed userscript managers, and a live QuotaGlass setup were not part of this acceptance run.
