import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { DIST, MANIFESTS, ROOT, VERSION, writeText } from './common.mjs';

const CHROME_ASSET = `AI-Usage-Tracker-chrome-v${VERSION}.zip`;
const FIREFOX_ASSET = `ai-usage-tracker-firefox-v${VERSION}.xpi`;
const CHROME_BRIDGE_ASSET = `AI-Usage-Tracker-chrome-bridge-v${VERSION}.zip`;
const FIREFOX_BRIDGE_ASSET = `ai-usage-tracker-firefox-bridge-v${VERSION}.xpi`;
const NATIVE_SCHEDULER_ASSET = `AI-Usage-Tracker-native-scheduler-v${VERSION}.zip`;
const USERSCRIPT_ASSET = 'ai-usage-tracker.user.js';

export async function validateReleaseProvenance({ checkBuiltArtifacts = false } = {}) {
  const failures = [];
  const readText = async (rel) => fs.readFile(path.join(ROOT, rel), 'utf8');
  const readJson = async (rel) => JSON.parse(await readText(rel));

  const pkg = await readJson('package.json');
  expectEqual(failures, 'package.json version', pkg.version, VERSION);

  const mcpPackage = await readJson('mcp/package.json');
  expectEqual(failures, 'mcp/package.json version', mcpPackage.version, VERSION);

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
  expectMatch(failures, 'build/common.mjs package source', common, /PACKAGE_JSON\s*=\s*JSON\.parse\(/);
  expectMatch(failures, 'build/common.mjs VERSION source', common, /export const VERSION = PACKAGE_JSON\.version/);

  for (const target of ['chrome', 'firefox']) {
    const manifest = JSON.parse(await fs.readFile(path.join(MANIFESTS, `${target}.json`), 'utf8'));
    expectEqual(failures, `manifests/${target}.json version`, manifest.version, VERSION);
  }

  const header = await readText('userscript/header.txt');
  expectIncludes(failures, 'userscript @version template', header, '@version      __AUT_VERSION__');
  expectIncludes(failures, 'userscript updateURL', header, `releases/latest/download/${USERSCRIPT_ASSET}`);
  expectIncludes(failures, 'userscript downloadURL', header, `releases/latest/download/${USERSCRIPT_ASSET}`);

  const readme = await readText('README.md');
  expectIncludes(failures, 'README version badge', readme, `version-${VERSION}-blue.svg`);
  expectIncludes(failures, 'README Chrome asset', readme, CHROME_ASSET);
  expectIncludes(failures, 'README Firefox asset', readme, FIREFOX_ASSET);
  expectIncludes(failures, 'README Chrome bridge asset', readme, CHROME_BRIDGE_ASSET);
  expectIncludes(failures, 'README Firefox bridge asset', readme, FIREFOX_BRIDGE_ASSET);
  expectIncludes(failures, 'README native scheduler asset', readme, NATIVE_SCHEDULER_ASSET);
  expectIncludes(failures, 'README userscript asset', readme, USERSCRIPT_ASSET);
  expectIncludes(failures, 'README checksum asset', readme, 'SHA256SUMS.txt');
  expectCurrentVersionLiterals(failures, 'README release references', readme);

  for (const rel of ['src/ui/popup.html', 'src/ui/options.html', 'src/ui/sidepanel.html']) {
    const template = await readText(rel);
    expectIncludes(failures, `${rel} version template`, template, '__AUT_VERSION__');
  }

  for (const rel of ['src/ui/options.js', 'src/ui/popup.js', 'src/ui/widget.js']) {
    const source = await readText(rel);
    expectMatch(
      failures,
      `${rel} runtime version import`,
      source,
      /import\s+\{\s*APP_VERSION\s*\}\s+from ['"]\.\.\/lib\/version\.js['"]/,
    );
  }

  const versionModule = await readText('src/lib/version.js');
  expectIncludes(failures, 'runtime version injection hook', versionModule, '__AUT_VERSION__');

  const mcpServer = await readText('mcp/server.mjs');
  expectIncludes(failures, 'MCP root package import', mcpServer, "import rootPackage from '../package.json' with { type: 'json' };");
  expectMatch(failures, 'MCP SERVER_VERSION source', mcpServer, /const SERVER_VERSION = rootPackage\.version/);

  const changelog = await readText('CHANGELOG.md');
  expectMatch(failures, 'CHANGELOG current entry', changelog, new RegExp(`^## v${escapeRegex(VERSION)}\\b`, 'm'));

  const claude = await readOptionalText('CLAUDE.md');
  if (claude != null) {
    expectIncludes(failures, 'CLAUDE Chrome asset', claude, `dist/chrome/${CHROME_ASSET}`);
    expectIncludes(failures, 'CLAUDE Firefox asset', claude, `dist/firefox/${FIREFOX_ASSET}`);
    expectMatch(failures, 'CLAUDE current status', claude, new RegExp(`^- v${escapeRegex(VERSION)}\\b`, 'm'));
  }

  const workflowDir = path.join(ROOT, '.github', 'workflows');
  const workflowFiles = await listFilesIfPresent(workflowDir);
  if (workflowFiles.length) {
    failures.push(`GitHub Actions workflows are disallowed; remove ${workflowFiles.map((p) => path.relative(ROOT, p)).join(', ')}`);
  }

  const gitignore = await readText('.gitignore');
  if (/^package-lock\.json$/m.test(gitignore)) {
    failures.push('package-lock.json must not be ignored');
  }

  if (checkBuiltArtifacts) await validateBuiltArtifacts(failures);

  if (failures.length) {
    throw new Error(`Release provenance check failed:\n- ${failures.join('\n- ')}`);
  }
}

async function validateBuiltArtifacts(failures) {
  for (const [target, packageName] of [['chrome', CHROME_ASSET], ['firefox', FIREFOX_ASSET]]) {
    const manifest = await readBuiltJSON(`dist/${target}/manifest.json`, failures);
    if (manifest) expectEqual(failures, `dist/${target}/manifest.json version`, manifest.version, VERSION);
    await expectBuiltFile(failures, `dist/${packageName}`, path.join(DIST, packageName));
    for (const rel of ['ui/popup.html', 'ui/options.html', 'ui/sidepanel.html']) {
      const html = await readBuiltText(`dist/${target}/${rel}`, failures);
      if (html != null) expectIncludes(failures, `dist/${target}/${rel} version`, html, `v${VERSION}`);
    }
  }

  const userscript = await readBuiltText('dist/userscript/ai-usage-tracker.user.js', failures);
  if (userscript != null) {
    expectMatch(
      failures,
      'dist userscript @version',
      userscript,
      new RegExp(`@version\\s+${escapeRegex(VERSION)}\\b`),
    );
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

function expectCurrentVersionLiterals(failures, label, text) {
  const versions = [...text.matchAll(/(?<![\d.])v?(\d+\.\d+\.\d+)(?![\d.])/g)]
    .map((match) => match[1]);
  for (const version of versions) {
    if (version !== VERSION) failures.push(`${label} contains stale version ${version}`);
  }
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

async function readOptionalText(rel) {
  try {
    return await fs.readFile(path.join(ROOT, rel), 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

async function readBuiltText(rel, failures) {
  try {
    return await fs.readFile(path.join(ROOT, rel), 'utf8');
  } catch {
    failures.push(`${rel} is missing from the build output`);
    return null;
  }
}

async function readBuiltJSON(rel, failures) {
  const text = await readBuiltText(rel, failures);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    failures.push(`${rel} is not valid JSON`);
    return null;
  }
}

async function expectBuiltFile(failures, label, abs) {
  try {
    await fs.access(abs);
  } catch {
    failures.push(`${label} is missing from the build output`);
  }
}
