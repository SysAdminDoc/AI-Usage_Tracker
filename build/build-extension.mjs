// Reusable extension build — produces dist/<target>/ with bundled background.js,
// content.js, popup.js, options.js, plus copied HTML/CSS/icons and manifest.
//
// Caller passes { target: 'chrome' | 'firefox' } so the right manifest is used.

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ROOT, SRC, MANIFESTS, DIST, ICONS,
  loadEsbuild, clean, ensureDir, copyFile, copyVersionedFile, copyDir, readJSON, writeJSON,
  log, VERSION,
} from './common.mjs';

export async function buildExtension({ target, bridge = false }) {
  const esbuild = await loadEsbuild();
  const profile = bridge ? `${target}-bridge` : target;
  const outDir = path.join(DIST, profile);
  await clean(outDir);

  // 1) Bundle JS entry points.
  const bundles = [
    { entry: path.join(SRC, 'background.js'),       out: path.join(outDir, 'background.js'),       format: 'esm',  isWorker: true  },
    { entry: path.join(SRC, 'page-interceptor.js'), out: path.join(outDir, 'page-interceptor.js'), format: 'iife', isWorker: false },
    { entry: path.join(SRC, 'page-bridge.js'),      out: path.join(outDir, 'page-bridge.js'),      format: 'iife', isWorker: false },
    { entry: path.join(SRC, 'content.js'),          out: path.join(outDir, 'content.js'),          format: 'iife', isWorker: false },
    { entry: path.join(SRC, 'analytics-scraper.js'),out: path.join(outDir, 'analytics-scraper.js'),format: 'iife', isWorker: false },
    { entry: path.join(SRC, 'ui', 'popup.js'),      out: path.join(outDir, 'ui', 'popup.js'),      format: 'iife', isWorker: false },
    { entry: path.join(SRC, 'ui', 'sidepanel.js'),  out: path.join(outDir, 'ui', 'sidepanel.js'),  format: 'iife', isWorker: false },
    { entry: path.join(SRC, 'ui', 'options.js'),    out: path.join(outDir, 'ui', 'options.js'),    format: 'iife', isWorker: false },
  ];

  for (const b of bundles) {
    await ensureDir(path.dirname(b.out));
    await esbuild.build({
      entryPoints: [b.entry],
      bundle:   true,
      format:   b.format,
      outfile:  b.out,
      target:   ['chrome111', 'firefox115'],
      platform: 'browser',
      minify:   false,
      sourcemap: false,
      legalComments: 'inline',
      logLevel: 'warning',
    });
  }

  // 2) Copy static HTML / CSS / icons.
  await copyVersionedFile(path.join(SRC, 'ui', 'popup.html'),  path.join(outDir, 'ui', 'popup.html'));
  await copyFile(path.join(SRC, 'ui', 'popup.css'),   path.join(outDir, 'ui', 'popup.css'));
  await copyVersionedFile(path.join(SRC, 'ui', 'sidepanel.html'), path.join(outDir, 'ui', 'sidepanel.html'));
  await copyFile(path.join(SRC, 'ui', 'sidepanel.css'), path.join(outDir, 'ui', 'sidepanel.css'));
  await copyVersionedFile(path.join(SRC, 'ui', 'options.html'),path.join(outDir, 'ui', 'options.html'));
  await copyFile(path.join(SRC, 'ui', 'options.css'), path.join(outDir, 'ui', 'options.css'));
  await copyFile(path.join(SRC, 'ui', 'theme.css'),   path.join(outDir, 'ui', 'theme.css'));
  await copyFile(path.join(SRC, 'ui', 'widget.css'),  path.join(outDir, 'ui', 'widget.css'));
  await copyDir(ICONS, path.join(outDir, 'icons'));

  // 3) Manifest — pull from manifests/<target>.json and stamp the version.
  const sourceManifest = await readJSON(path.join(MANIFESTS, `${target}.json`));
  const manifest = applyBridgeProfile(sourceManifest, { bridge });
  if (manifest.version !== VERSION) {
    manifest.version = VERSION;
  }
  await writeJSON(path.join(outDir, 'manifest.json'), manifest);

  // 4) Pack into a ZIP for distribution.
  const zipName = target === 'firefox'
    ? `ai-usage-tracker-firefox${bridge ? '-bridge' : ''}-v${VERSION}.xpi`
    : `AI-Usage-Tracker-${target}${bridge ? '-bridge' : ''}-v${VERSION}.zip`;
  const zipPath = path.join(DIST, zipName);
  await removeStalePackages(target, bridge, zipPath);
  await zipDir(outDir, zipPath);

  log('extension', `built ${profile} → ${path.relative(ROOT, outDir)}`);
  log('extension', `packaged ${path.relative(ROOT, zipPath)}`);
  return { outDir, zipPath };
}

export function applyBridgeProfile(sourceManifest, { bridge = false } = {}) {
  const manifest = JSON.parse(JSON.stringify(sourceManifest));
  const permissions = new Set(manifest.permissions || []);
  if (bridge) {
    permissions.add('nativeMessaging');
    manifest.description = `${manifest.description} Optional QuotaGlass native-messaging companion.`;
  } else {
    permissions.delete('nativeMessaging');
  }
  manifest.permissions = [...permissions];
  return manifest;
}

async function removeStalePackages(target, bridge, keepPath) {
  await ensureDir(DIST);
  const prefix = target === 'firefox'
    ? `ai-usage-tracker-firefox${bridge ? '-bridge' : ''}-v`
    : `AI-Usage-Tracker-${target}${bridge ? '-bridge' : ''}-v`;
  const suffix = target === 'firefox' ? '.xpi' : '.zip';
  const entries = await fs.readdir(DIST, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(prefix) || !entry.name.endsWith(suffix)) continue;
    const abs = path.join(DIST, entry.name);
    if (abs !== keepPath) await fs.rm(abs, { force: true });
  }
  await fs.rm(keepPath, { force: true });
}

// Simple ZIP packer using Node's built-in zlib — avoids an extra dependency.
export async function zipDir(srcDir, zipPath) {
  const { createWriteStream } = await import('node:fs');
  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  const zlib = await import('node:zlib');

  const entries = [];
  await walk(srcDir, srcDir, entries);

  // Build ZIP (no compression for simplicity — keeps it under ~200 KB anyway).
  // Format: local file headers + central directory + EOCD.
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const e of entries) {
    const data = await fs.readFile(e.absPath);
    const nameBytes = Buffer.from(e.relPath, 'utf8');

    // Deflate-raw the data.
    const deflated = zlib.deflateRawSync(data, { level: 6 });
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);                  // method = deflate
    localHeader.writeUInt16LE(0, 10);                 // mod time
    localHeader.writeUInt16LE(0, 12);                 // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(deflated.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBytes, deflated);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(deflated.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + deflated.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralChunks);
  const centralSize = centralBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  await fs.writeFile(zipPath, Buffer.concat([...localChunks, centralBuf, eocd]));
}

async function walk(rootDir, dir, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(rootDir, abs, out);
    } else if (ent.isFile()) {
      const rel = path.relative(rootDir, abs).split(path.sep).join('/');
      out.push({ absPath: abs, relPath: rel });
    }
  }
}

// CRC32 — pure JS, used by ZIP.
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
