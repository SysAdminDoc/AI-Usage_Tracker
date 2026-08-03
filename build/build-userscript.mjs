// Build the Tampermonkey / Violentmonkey userscript bundle.
// - Bundles userscript/entry.js (which imports the same src/ modules).
// - Inlines theme.css and widget.css as globals so the shadow DOM picks them
//   up without a runtime fetch.
// - Prepends the Tampermonkey @meta header.
// - Writes dist/userscript/ai-usage-tracker.user.js

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT, SRC, DIST, loadEsbuild, clean, ensureDir, writeText, log, VERSION,
} from './common.mjs';

const ENTRY  = path.join(ROOT, 'userscript', 'entry.js');
const HEADER = path.join(ROOT, 'userscript', 'header.txt');

await main();

async function main() {
  const esbuild = await loadEsbuild();
  const outDir = path.join(DIST, 'userscript');
  await clean(outDir);

  const themeCSS  = await fs.readFile(path.join(SRC, 'ui', 'theme.css'),  'utf8');
  const widgetCSS = await fs.readFile(path.join(SRC, 'ui', 'widget.css'), 'utf8');
  const optionsCSS = await fs.readFile(path.join(SRC, 'ui', 'options.css'), 'utf8');
  const header    = await fs.readFile(HEADER, 'utf8');

  const inlineCss = `
  (function () {
    var g = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : (typeof window !== 'undefined' ? window : globalThis));
    g.__AUT_THEME_CSS__  = ${JSON.stringify(themeCSS)};
    g.__AUT_WIDGET_CSS__ = ${JSON.stringify(widgetCSS)};
    g.__AUT_OPTIONS_CSS__ = ${JSON.stringify(optionsCSS)};
    if (typeof globalThis !== 'undefined') {
      globalThis.__AUT_THEME_CSS__  = ${JSON.stringify(themeCSS)};
      globalThis.__AUT_WIDGET_CSS__ = ${JSON.stringify(widgetCSS)};
      globalThis.__AUT_OPTIONS_CSS__ = ${JSON.stringify(optionsCSS)};
    }
  })();
  `;

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    write: false,
    target: ['chrome111', 'firefox115'],
    platform: 'browser',
    minify: false,
    sourcemap: false,
    legalComments: 'inline',
    banner: { js: inlineCss },
    logLevel: 'warning',
  });

  const bundled = result.outputFiles[0].text;
  const final = `${header}\n${bundled}`;
  const outFile = path.join(outDir, 'ai-usage-tracker.user.js');
  await writeText(outFile, final);

  log('userscript', `built ai-usage-tracker.user.js v${VERSION} (${(final.length / 1024).toFixed(1)} KB)`);
}
