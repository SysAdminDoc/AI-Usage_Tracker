import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { DIST, MANIFESTS, ROOT, VERSION, writeText } from './common.mjs';

const CHROME_ASSET = `AI-Usage-Tracker-chrome-v${VERSION}.zip`;
const FIREFOX_ASSET = `ai-usage-tracker-firefox-v${VERSION}.xpi`;
const USERSCRIPT_ASSET = 'ai-usage-tracker.user.js';

export async function validateReleaseProvenance() {
  const failures = [];
  const readText = async (rel) => fs.readFile(path.join(ROOT, rel), 'utf8');
  const readJson = async (rel) => JSON.parse(await readText(rel));

  const pkg = await readJson('package.json');
  expectEqual(failures, 'package.json version', pkg.version, VERSION);

  const lock = await readJson('package-lock.json');
  expectEqual(failures, 'package-lock.json root version', lock.version, VERSION);
  expectEqual(failures, 'package-lock.json package version', lock.packages?.['']?.version, VERSION);

  const lockTracked = spawnSync('git', ['ls-files', '--error-unmatch', 'package-lock.json'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  if (lockTracked.status !== 0) {
    failures.push('package-lock.json must be tracked for deterministic local builds');
  }

  const common = await readText('build/common.mjs');
  expectMatch(failures, 'build/common.mjs VERSION', common, new RegExp(`VERSION = ['"]${escapeRegex(VERSION)}['"]`));

  for (const target of ['chrome', 'firefox']) {
    const manifest = JSON.parse(await fs.readFile(path.join(MANIFESTS, `${target}.json`), 'utf8'));
    expectEqual(failures, `manifests/${target}.json version`, manifest.version, VERSION);
  }

  const header = await readText('userscript/header.txt');
  expectMatch(failures, 'userscript @version', header, new RegExp(`@version\\s+${escapeRegex(VERSION)}\\b`));
  expectIncludes(failures, 'userscript updateURL', header, `releases/latest/download/${USERSCRIPT_ASSET}`);
  expectIncludes(failures, 'userscript downloadURL', header, `releases/latest/download/${USERSCRIPT_ASSET}`);

  const readme = await readText('README.md');
  expectIncludes(failures, 'README version badge', readme, `version-${VERSION}-blue.svg`);
  expectIncludes(failures, 'README Chrome asset', readme, CHROME_ASSET);
  expectIncludes(failures, 'README Firefox asset', readme, FIREFOX_ASSET);
  expectIncludes(failures, 'README userscript asset', readme, USERSCRIPT_ASSET);
  expectIncludes(failures, 'README checksum asset', readme, 'SHA256SUMS.txt');

  const popup = await readText('src/ui/popup.html');
  expectIncludes(failures, 'popup static version', popup, `v${VERSION}`);

  const optionsHtml = await readText('src/ui/options.html');
  expectIncludes(failures, 'options static version', optionsHtml, `v${VERSION}`);

  for (const rel of ['src/ui/options.js', 'src/ui/popup.js', 'src/ui/widget.js']) {
    const source = await readText(rel);
    expectMatch(failures, `${rel} VERSION`, source, new RegExp(`VERSION = ['"]${escapeRegex(VERSION)}['"]`));
  }

  const changelog = await readText('CHANGELOG.md');
  expectMatch(failures, 'CHANGELOG current entry', changelog, new RegExp(`^## v${escapeRegex(VERSION)}\\b`, 'm'));

  const workflowDir = path.join(ROOT, '.github', 'workflows');
  const workflowFiles = await listFilesIfPresent(workflowDir);
  if (workflowFiles.length) {
    failures.push(`GitHub Actions workflows are disallowed; remove ${workflowFiles.map((p) => path.relative(ROOT, p)).join(', ')}`);
  }

  const gitignore = await readText('.gitignore');
  if (/^package-lock\.json$/m.test(gitignore)) {
    failures.push('package-lock.json must not be ignored');
  }

  if (failures.length) {
    throw new Error(`Release provenance check failed:\n- ${failures.join('\n- ')}`);
  }
}

export async function writeReleaseChecksums() {
  const artifactRelPaths = [
    CHROME_ASSET,
    FIREFOX_ASSET,
    path.join('userscript', USERSCRIPT_ASSET),
  ];

  const lines = [];
  for (const rel of artifactRelPaths) {
    const abs = path.join(DIST, rel);
    const buf = await fs.readFile(abs);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    lines.push(`${hash}  ${rel.split(path.sep).join('/')}`);
  }

  await writeText(path.join(DIST, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
}

function expectEqual(failures, label, actual, expected) {
  if (actual !== expected) failures.push(`${label} expected ${expected}, got ${actual ?? '(missing)'}`);
}

function expectIncludes(failures, label, text, needle) {
  if (!text.includes(needle)) failures.push(`${label} missing ${needle}`);
}

function expectMatch(failures, label, text, regex) {
  if (!regex.test(text)) failures.push(`${label} does not match ${regex}`);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listFilesIfPresent(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await listFilesIfPresent(abs));
      else if (entry.isFile()) out.push(abs);
    }
    return out;
  } catch (e) {
    if (e?.code === 'ENOENT') return [];
    throw e;
  }
}
