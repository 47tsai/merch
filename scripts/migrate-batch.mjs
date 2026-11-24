#!/usr/bin/env node
/**
 * migrate-batch.mjs — migrate ONE batch of merch images to WebP.
 *
 * Part of the merch image WebP migration (see PLAN.md §5–§6 and
 * workflow/README.md). Runs inside the `migrate-images` GitHub Actions
 * workflow, but is also runnable locally against a scratch copy for testing.
 *
 * What it does, per listed file (repo-relative `data/<work>/<cat>/<id>/images/<file>`):
 *   1. Convert to WebP with `cwebp -q 80 -m 6` (no resize). If `cwebp` is
 *      absent, fall back to Python PIL `method=6` (same libwebp settings).
 *      The output file must be smaller than the input and keep the input's
 *      width/height (checked via `webpinfo` / PIL / `file`).
 *   2. Update that Item's `data.json`: ONLY the `file` field of the matching
 *      `images` entry changes (`id` / `alt` / `isCover` / `sha` untouched).
 *   3. If the image is the cover, update the category `index.json` `cover`
 *      field to the new filename; otherwise leave `index.json` untouched.
 *   4. Delete the old file (only after the JSON writes succeed).
 * After all files: bump `package.json` patch +1 and run the repo's own
 * `scripts/sync-version.mjs` (syncs `public/data/version.json` and
 * `package-lock.json`). Pass `--no-bump-version` to skip step 4.
 *
 * It never reads `mapping.csv` — the batch file list comes from the caller
 * (the workflow computes it live from `find data -name '*.jpeg' -o
 * -name '*.png'` sorted by size desc). It is safe to re-run on the same
 * list: already-migrated files are detected (new .webp on disk + `data.json`
 * already pointing at it) and skipped, and a file converted but not yet
 * JSON-updated resumes at the JSON step instead of re-encoding.
 *
 * Usage:
 *   node scripts/migrate-batch.mjs --list <batch.txt> [--root <repo>]
 *       [--manifest <out.json>] [--quality 80] [--method 6]
 *       [--no-bump-version]
 *
 * Exit code: 0 = batch migrated (or already migrated); 1 = any check failed.
 * On failure the script stops immediately; files already processed stay
 * processed and are picked up as "already-done" on re-run.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_RE = /^data\/[^/]+\/[a-z]\/[^/]+\/images\/[^/]+\.(?:jpg|jpeg|png)$/i;
const BATCH_MAX = 10;

function fail(message) {
  throw new Error(`[migrate-batch] ${message}`);
}

function parseArgs(argv) {
  const args = { root: process.cwd(), quality: 80, method: 6, bumpVersion: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') args.list = argv[++i];
    else if (arg === '--root') args.root = path.resolve(argv[++i]);
    else if (arg === '--manifest') args.manifest = argv[++i];
    else if (arg === '--quality') args.quality = Number(argv[++i]);
    else if (arg === '--method') args.method = Number(argv[++i]);
    else if (arg === '--no-bump-version') args.bumpVersion = false;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/migrate-batch.mjs --list <batch.txt> [--root <repo>] [--manifest <out.json>] [--quality 80] [--method 6] [--no-bump-version]');
      process.exit(0);
    } else fail(`unknown argument: ${arg}`);
  }
  if (!args.list) fail('--list <batch.txt> is required.');
  if (!Number.isInteger(args.quality) || args.quality < 1 || args.quality > 100) fail('--quality must be 1-100.');
  if (!Number.isInteger(args.method) || args.method < 0 || args.method > 6) fail('--method must be 0-6.');
  return args;
}

function commandExists(cmd) {
  try {
    execFileSync('command', ['-v', cmd], { encoding: 'utf8', shell: '/bin/sh', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, cmdArgs, opts = {}) {
  try {
    return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  } catch (error) {
    const detail = String(error.stderr || error.message || error).trim();
    fail(`command failed: ${cmd} ${cmdArgs.join(' ')}\n${detail}`);
    return ''; // unreachable; keeps linters quiet
  }
}

/** Dimensions of a JPEG/PNG via PIL, else via `file`. Returns {width,height} or null. */
function sourceDimensions(filePath) {
  if (commandExists('python3')) {
    try {
      const out = run('python3', ['-c',
        'import sys; from PIL import Image; im = Image.open(sys.argv[1]); print(f"{im.size[0]}x{im.size[1]}")',
        filePath]).trim();
      const m = out.match(/^(\d+)x(\d+)$/);
      if (m) return { width: Number(m[1]), height: Number(m[2]) };
    } catch { /* fall through to `file` */ }
  }
  if (commandExists('file')) {
    try {
      const out = run('file', ['-b', filePath]);
      const m = out.match(/(\d+)x(\d+)/);
      if (m) return { width: Number(m[1]), height: Number(m[2]) };
    } catch { /* fall through */ }
  }
  return null;
}

/** Dimensions of a WebP via `webpinfo`, else via PIL. Returns {width,height} or null. */
function webpDimensions(filePath) {
  if (commandExists('webpinfo')) {
    try {
      const out = run('webpinfo', [filePath]);
      const w = out.match(/Width:\s*(\d+)/);
      const h = out.match(/Height:\s*(\d+)/);
      if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
      const canvas = out.match(/Canvas size:\s*(\d+)\s*x\s*(\d+)/);
      if (canvas) return { width: Number(canvas[1]), height: Number(canvas[2]) };
    } catch { /* fall through to PIL */ }
  }
  if (commandExists('python3')) {
    try {
      const out = run('python3', ['-c',
        'import sys; from PIL import Image; im = Image.open(sys.argv[1]); print(f"{im.size[0]}x{im.size[1]}")',
        filePath]).trim();
      const m = out.match(/^(\d+)x(\d+)$/);
      if (m) return { width: Number(m[1]), height: Number(m[2]) };
    } catch { /* fall through */ }
  }
  return null;
}

function detectEncoder() {
  if (commandExists('cwebp')) return 'cwebp';
  if (commandExists('python3')) {
    try {
      run('python3', ['-c', 'import PIL']);
      return 'pil';
    } catch { /* no PIL */ }
  }
  fail('no encoder available: install `cwebp` (`apt-get install -y webp`) or Python Pillow.');
  return ''; // unreachable
}

function convert(encoder, src, dst, quality, method) {
  if (encoder === 'cwebp') {
    run('cwebp', ['-q', String(quality), '-m', String(method), src, '-o', dst]);
  } else {
    run('python3', ['-c',
      'import sys; from PIL import Image; im = Image.open(sys.argv[1]); im.save(sys.argv[2], "WEBP", quality=int(sys.argv[3]), method=int(sys.argv[4]))',
      src, dst, String(quality), String(method)]);
  }
  if (!fs.existsSync(dst) || fs.statSync(dst).size === 0) fail(`conversion produced no output for ${src}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Only `file` changes on the matching images entry; everything else must be identical. */
function updateDataJson(itemDir, oldName, newName) {
  const dataJsonPath = path.join(itemDir, 'data.json');
  if (!fs.existsSync(dataJsonPath)) fail(`missing data.json: ${dataJsonPath}`);
  const before = readJson(dataJsonPath);
  if (!Array.isArray(before.images)) fail(`${dataJsonPath}: images is not an array.`);
  const matches = before.images.filter((img) => img && img.file === oldName);
  if (matches.length !== 1) fail(`${dataJsonPath}: expected exactly 1 images entry with file=${oldName}, found ${matches.length}.`);
  const entry = matches[0];
  const isCover = entry.isCover === true;

  const after = JSON.parse(JSON.stringify(before));
  after.images.find((img) => img && img.file === oldName).file = newName;

  // Prove nothing else changed: the changed entry differs only in `file`,
  // every other entry is deep-identical, and top-level fields are identical.
  const beforeEntry = entry;
  const afterEntry = after.images.find((img) => img && img.id === beforeEntry.id);
  for (const key of Object.keys(beforeEntry)) {
    if (key === 'file') continue;
    if (JSON.stringify(beforeEntry[key]) !== JSON.stringify(afterEntry[key])) {
      fail(`${dataJsonPath}: refusing to change field ${key} on image ${beforeEntry.id}.`);
    }
  }
  if (JSON.stringify(before.images.filter((img) => img !== beforeEntry))
    !== JSON.stringify(after.images.filter((img) => img !== afterEntry))) {
    fail(`${dataJsonPath}: images array changed beyond the one file rename.`);
  }
  writeJson(dataJsonPath, after);
  return { isCover };
}

/**
 * Sync the category index cover. Returns true if index.json was rewritten.
 * Non-cover images must leave index.json byte-identical.
 */
function updateIndexJson(catDir, itemId, oldName, newName, isCover) {
  const indexPath = path.join(catDir, 'index.json');
  if (!fs.existsSync(indexPath)) fail(`missing index.json: ${indexPath}`);
  const before = readJson(indexPath);
  if (!Array.isArray(before.items)) fail(`${indexPath}: items is not an array.`);
  const entries = before.items.filter((e) => e && e.id === itemId);
  if (entries.length !== 1) fail(`${indexPath}: expected exactly 1 item with id=${itemId}, found ${entries.length}.`);
  const entry = entries[0];
  if (entry.cover === oldName) {
    if (!isCover) fail(`${indexPath}: cover points at ${oldName} but data.json does not mark it isCover — inconsistent data, refusing.`);
    const after = JSON.parse(JSON.stringify(before));
    after.items.find((e) => e && e.id === itemId).cover = newName;
    writeJson(indexPath, after);
    return true;
  }
  if (entry.cover === undefined || entry.cover === null) {
    if (isCover) fail(`${indexPath}: data.json marks ${oldName} as cover but index.json has no cover — inconsistent data, refusing.`);
    return false;
  }
  if (isCover) fail(`${indexPath}: data.json marks ${oldName} as cover but index.json cover is ${entry.cover} — inconsistent data, refusing.`);
  return false;
}

function bumpVersion(root) {
  const packagePath = path.join(root, 'package.json');
  const pkg = readJson(packagePath);
  const m = String(pkg.version || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) fail(`package.json has an invalid version: ${pkg.version || '(empty)'}`);
  const oldVersion = pkg.version;
  const newVersion = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  pkg.version = newVersion;
  writeJson(packagePath, pkg);
  // The repo's own sync script is the single source of truth for
  // public/data/version.json + package-lock.json — never hand-edit those.
  run('node', ['scripts/sync-version.mjs'], { cwd: root });
  const versionJson = readJson(path.join(root, 'public/data/version.json'));
  if (versionJson.version !== newVersion) {
    fail(`version sync mismatch after bump: package.json=${newVersion}, public/data/version.json=${versionJson.version}`);
  }
  return { oldVersion, newVersion };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  const listPath = path.resolve(args.list);
  const lines = fs.readFileSync(listPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) fail(`batch list is empty: ${listPath}`);
  if (lines.length > BATCH_MAX) fail(`batch list has ${lines.length} files, max ${BATCH_MAX} per batch.`);
  for (const rel of lines) {
    if (!IMAGE_RE.test(rel)) fail(`batch list entry is not a convertible image path: ${rel}`);
  }

  const encoder = detectEncoder();
  console.log(`[migrate-batch] encoder=${encoder} quality=${args.quality} method=${args.method} files=${lines.length} root=${root}`);

  const files = [];
  for (const rel of lines) {
    const oldPath = path.join(root, rel);
    const dir = path.dirname(oldPath); // data/<work>/<cat>/<id>/images
    const itemDir = path.dirname(dir);
    const catDir = path.dirname(itemDir);
    const itemId = path.basename(itemDir);
    const oldName = path.basename(oldPath);
    const stem = oldName.replace(/\.[^.]+$/, '');
    const newName = `${stem}.webp`;
    const newRel = path.posix.join(path.dirname(rel).split(path.sep).join('/'), newName);
    const newPath = path.join(root, newRel);
    const dataJsonPath = path.join(itemDir, 'data.json');

    const oldExists = fs.existsSync(oldPath);
    const newExists = fs.existsSync(newPath);
    const dataJson = fs.existsSync(dataJsonPath) ? readJson(dataJsonPath) : null;
    const pointsAtOld = dataJson?.images?.some((img) => img && img.file === oldName) ?? false;
    const pointsAtNew = dataJson?.images?.some((img) => img && img.file === newName) ?? false;

    let status;
    let oldBytes = oldExists ? fs.statSync(oldPath).size : null;
    let newBytes = newExists ? fs.statSync(newPath).size : null;
    let width = null;
    let height = null;
    let isCover = null;
    let indexChanged = false;

    if (!oldExists && newExists && pointsAtNew && !pointsAtOld) {
      // Already migrated (e.g. re-run after an interrupted earlier run).
      status = 'already-done';
    } else if (oldExists && newExists && pointsAtOld && !pointsAtNew) {
      // Converted, but JSON not yet updated — resume at the JSON step.
      status = 'resume-json';
    } else if (oldExists && !newExists && pointsAtOld && !pointsAtNew) {
      status = 'convert';
    } else if (!oldExists && newExists && pointsAtOld && !pointsAtNew) {
      // Old file already deleted but JSON still points at it (should not
      // happen — we delete old only after JSON writes — but tolerate it).
      status = 'resume-json';
    } else {
      fail(`${rel}: unexpected state (oldExists=${oldExists}, newExists=${newExists}, data.json→old=${pointsAtOld}, data.json→new=${pointsAtNew}). Inspect manually; refusing to guess.`);
    }

    if (status === 'convert') {
      const srcDims = sourceDimensions(oldPath);
      if (!srcDims) fail(`${rel}: cannot read source dimensions (need PIL or \`file\`).`);
      ({ width, height } = srcDims);
      convert(encoder, oldPath, newPath, args.quality, args.method);
      newBytes = fs.statSync(newPath).size;
      if (newBytes >= oldBytes) fail(`${rel}: WebP (${newBytes} bytes) is not smaller than source (${oldBytes} bytes) — refusing.`);
      const outDims = webpDimensions(newPath);
      if (!outDims) fail(`${rel}: cannot read WebP dimensions (need webpinfo or PIL).`);
      if (outDims.width !== width || outDims.height !== height) {
        fail(`${rel}: dimension mismatch after conversion: source ${width}x${height}, WebP ${outDims.width}x${outDims.height}.`);
      }
    } else if (status === 'resume-json' || status === 'already-done') {
      const srcDims = oldExists ? sourceDimensions(oldPath) : null;
      const outDims = webpDimensions(newPath);
      if (!outDims) fail(`${rel}: cannot read WebP dimensions (need webpinfo or PIL).`);
      if (srcDims) {
        if (outDims.width !== srcDims.width || outDims.height !== srcDims.height) {
          fail(`${rel}: dimension mismatch: source ${srcDims.width}x${srcDims.height}, WebP ${outDims.width}x${outDims.height}.`);
        }
        ({ width, height } = srcDims);
      } else {
        ({ width, height } = outDims);
      }
      if (newBytes !== null && oldBytes !== null && newBytes >= oldBytes) {
        fail(`${rel}: existing WebP (${newBytes} bytes) is not smaller than source (${oldBytes} bytes) — refusing.`);
      }
    }

    if (status !== 'already-done') {
      // JSON updates first; only then delete the old file.
      const dataResult = updateDataJson(itemDir, oldName, newName);
      isCover = dataResult.isCover;
      indexChanged = updateIndexJson(catDir, itemId, oldName, newName, isCover);
      if (oldExists) fs.rmSync(oldPath);
    } else {
      const entry = dataJson.images.find((img) => img && img.file === newName);
      isCover = entry.isCover === true;
      const indexJson = readJson(path.join(catDir, 'index.json'));
      const indexed = indexJson.items.find((e) => e && e.id === itemId);
      indexChanged = indexed?.cover === newName && isCover;
    }

    if (oldBytes === null) {
      // Old file already gone (resume path): size is unknowable locally;
      // record null and let the workflow log carry the earlier numbers.
      oldBytes = null;
    }
    files.push({
      old_path: rel, new_path: newRel, old_bytes: oldBytes, new_bytes: newBytes,
      saved_bytes: oldBytes !== null && newBytes !== null ? oldBytes - newBytes : null,
      saved_pct: oldBytes !== null && newBytes !== null && oldBytes > 0
        ? Number(((100 * (oldBytes - newBytes)) / oldBytes).toFixed(1)) : null,
      width, height, is_cover: isCover, data_json: path.relative(root, dataJsonPath).split(path.sep).join('/'),
      index_json_changed: indexChanged, status,
    });
    console.log(`[migrate-batch] ${status} ${rel} (${oldBytes ?? '?'} → ${newBytes} bytes, cover=${isCover}, index_changed=${indexChanged})`);
  }

  let version = null;
  const didWork = files.some((f) => f.status !== 'already-done');
  if (args.bumpVersion && didWork) {
    version = bumpVersion(root);
    console.log(`[migrate-batch] version ${version.oldVersion} → ${version.newVersion}`);
  } else if (args.bumpVersion) {
    // Every file was already migrated by an earlier run of this script, so
    // the version bump for this batch already happened. Bumping again would
    // create a version bump with no content change — skip it.
    console.log('[migrate-batch] all files already migrated; version bump skipped');
  } else {
    console.log('[migrate-batch] version bump skipped (--no-bump-version)');
  }

  const converted = files.filter((f) => f.old_bytes !== null && f.new_bytes !== null);
  const totalOld = converted.reduce((s, f) => s + f.old_bytes, 0);
  const totalNew = converted.reduce((s, f) => s + f.new_bytes, 0);
  const manifest = {
    encoder, quality: args.quality, method: args.method, version,
    totals: {
      files: files.length,
      converted_files: converted.length,
      already_done_files: files.length - converted.length,
      old_bytes: totalOld, new_bytes: totalNew,
      saved_bytes: totalOld - totalNew,
      saved_pct: totalOld > 0 ? Number(((100 * (totalOld - totalNew)) / totalOld).toFixed(1)) : null,
    },
    files,
  };
  if (args.manifest) {
    fs.writeFileSync(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`[migrate-batch] manifest written: ${args.manifest}`);
  }
  if (converted.length > 0) {
    console.log(`[migrate-batch] TOTAL ${converted.length} converted: ${totalOld} → ${totalNew} bytes (-${manifest.totals.saved_pct}%)`);
  } else {
    console.log('[migrate-batch] TOTAL: all files were already migrated in an earlier run; no new conversions.');
  }
  console.log(JSON.stringify(manifest, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
