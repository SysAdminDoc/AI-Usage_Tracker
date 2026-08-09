import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './common.mjs';

const CONFIG_PATH = path.join(ROOT, 'tsconfig.ratchet.json');
const BASELINE_PATH = path.join(ROOT, 'build', 'typecheck-baseline.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const tscPath = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(process.execPath, [
  tscPath,
  '--project', CONFIG_PATH,
  '--noEmit',
  '--pretty', 'false',
], { cwd: ROOT, encoding: 'utf8' });
const output = `${result.stdout || ''}${result.stderr || ''}`;
const diagnostics = parseDiagnostics(output);
const grouped = groupDiagnostics(diagnostics);
const coveredFiles = (config.include || [])
  .map((file) => String(file).replaceAll('\\', '/'))
  .filter((file) => file.startsWith('src/'))
  .sort();
if (process.argv.includes('--update-baseline')) {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({
    schema: 'ai-usage-tracker.typecheck-baseline',
    version: 1,
    coveredFiles,
    diagnostics: Object.fromEntries(grouped),
  }, null, 2)}\n`);
  console.log(`[typecheck] wrote ratchet baseline with ${diagnostics.length} diagnostics`);
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
if (JSON.stringify(baseline.coveredFiles || []) !== JSON.stringify(coveredFiles)) {
  fail('ratchet baseline covered file set is stale; regenerate it deliberately with --update-baseline');
}
const unexpected = [];
for (const [fingerprint, count] of grouped) {
  const allowed = Number(baseline.diagnostics?.[fingerprint]) || 0;
  if (count > allowed) unexpected.push({ fingerprint, extra: count - allowed });
}

const baselineCount = Object.values(baseline.diagnostics || {})
  .reduce((sum, count) => sum + Number(count || 0), 0);
console.log(`[typecheck] ratchet covered files (${coveredFiles.length}): ${coveredFiles.join(', ')}`);
console.log(`[typecheck] ratchet diagnostics: ${diagnostics.length} current; ${baselineCount} baseline allowances`);

if (unexpected.length > 0 || (result.status !== 0 && diagnostics.length === 0)) {
  const lines = unexpected
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
    .slice(0, 40)
    .map(({ fingerprint, extra }) => `  +${extra} ${fingerprint}`);
  fail(`new typecheck diagnostics detected:\n${lines.join('\n') || output.trim()}`);
}

function parseDiagnostics(outputText) {
  const diagnostics = [];
  for (const line of String(outputText).split(/\r?\n/)) {
    const match = line.match(/^(.*?)(?:\((\d+),(\d+)\))?: error TS(\d+): (.*)$/);
    if (!match) continue;
    diagnostics.push({
      file: normalizeFile(match[1] || '<config>'),
      code: Number(match[4]),
      message: match[5].replace(/\s+/g, ' ').trim(),
    });
  }
  return diagnostics;
}

function normalizeFile(file) {
  const value = String(file || '<config>').replaceAll('\\', '/');
  if (value === '<config>' || value === 'error') return '<config>';
  const absolute = path.isAbsolute(value) ? value : path.join(ROOT, value);
  return path.relative(ROOT, absolute).replaceAll('\\', '/');
}

function groupDiagnostics(items) {
  const grouped = new Map();
  for (const diagnostic of items) {
    const key = `${diagnostic.file}|TS${diagnostic.code}|${diagnostic.message}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  return grouped;
}

function fail(message) {
  console.error(`[typecheck] ratchet failed: ${message}`);
  process.exit(1);
}
