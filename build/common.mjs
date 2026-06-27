// Shared build utilities — version sync, directory ops, esbuild loader.

import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, '..');
export const SRC  = path.join(ROOT, 'src');
export const MANIFESTS = path.join(ROOT, 'manifests');
export const DIST = path.join(ROOT, 'dist');
export const ICONS = path.join(SRC, 'icons');

// Source of truth for the version string.
export const VERSION = '0.2.2';

let cachedEsbuild = null;

export async function loadEsbuild() {
  if (cachedEsbuild) return cachedEsbuild;
  try {
    const require = createRequire(import.meta.url);
    cachedEsbuild = require('esbuild');
    return cachedEsbuild;
  } catch (e) {
    console.error('\n[build] esbuild is not installed. Run:\n  npm install\nfrom the project root.\n');
    throw e;
  }
}

export async function clean(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

export async function copyDir(src, dest) {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await copyDir(s, d);
    } else if (ent.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}

export async function readJSON(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

export async function writeJSON(p, data) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export async function writeText(p, text) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, text, 'utf8');
}

export function fileExists(p) {
  try { fss.accessSync(p); return true; } catch { return false; }
}

export function log(stage, msg) {
  process.stdout.write(`[${stage}] ${msg}\n`);
}
