import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const api = read('src/api.ts');
const ui = read('src/works-management.ts');
const store = read('src/store.ts');
const worker = read('worker/src/index.ts');

const required = [
  ['src/api.ts', /export async function createWork\(/, 'createWork API'],
  ['src/api.ts', /export async function updateWork\(/, 'updateWork API'],
  ['src/api.ts', /export async function deleteWork\(/, 'deleteWork API'],
  ['src/api.ts', /request\('\/works/, 'work API route'],
  // The page must go through the store (optimistic update + settle + one
  // authoritative re-read), never straight to the api work functions.
  ['src/works-management.ts', /storeRef\.createWork\(/, 'create work goes through the store'],
  ['src/works-management.ts', /storeRef\.updateWork\(/, 'edit work goes through the store'],
  ['src/works-management.ts', /storeRef\.deleteWork\(/, 'delete work goes through the store'],
  // The store methods must exist and call the api work functions.
  ['src/store.ts', /async createWork\(/, 'store createWork'],
  ['src/store.ts', /async updateWork\(/, 'store updateWork'],
  ['src/store.ts', /async deleteWork\(/, 'store deleteWork'],
  ['src/store.ts', /createRemoteWork\(/, 'store createWork calls the api'],
  ['src/store.ts', /updateRemoteWork\(/, 'store updateWork calls the api'],
  ['src/store.ts', /deleteRemoteWork\(/, 'store deleteWork calls the api'],
  ['worker/src/index.ts', /async function createWork\(/, 'worker createWork handler'],
  ['worker/src/index.ts', /async function updateWork\(/, 'worker updateWork handler'],
  ['worker/src/index.ts', /async function deleteWork\(/, 'worker deleteWork handler'],
  ['worker/src/index.ts', /createAtomicCommit\(/, 'atomic work commit'],
  ['worker/src/index.ts', /force:\s*false/, 'non-force branch update'],
];

const contents = {
  'src/api.ts': api,
  'src/works-management.ts': ui,
  'src/store.ts': store,
  'worker/src/index.ts': worker,
};

const errors = [];
for (const [file, pattern, label] of required) {
  if (!pattern.test(contents[file])) errors.push(`${file}: missing ${label}`);
}

// The page must not call the api work functions directly: after removing
// the store calls, no bare createWork/updateWork/deleteWork call may remain.
const uiWithoutStoreCalls = ui.replace(/storeRef\.(createWork|updateWork|deleteWork)\(/g, '');
for (const fn of ['createWork', 'updateWork', 'deleteWork']) {
  if (new RegExp(`\\b${fn}\\(`).test(uiWithoutStoreCalls)) {
    errors.push(`src/works-management.ts: must not call api ${fn} directly; use the store method`);
  }
}

// Each store work method must serialize through the write queue and settle
// like every other mutation (optimistic update, then settled + re-read).
function methodBody(source, name, nextMarker) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return '';
  const end = source.indexOf(nextMarker, start);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}
const workMethods = [
  ['createWork', 'async updateWork('],
  ['updateWork', 'async deleteWork('],
  ['deleteWork', 'async uploadImage('],
];
for (const [name, nextMarker] of workMethods) {
  const body = methodBody(store, name, nextMarker);
  if (!/enqueueWrite/.test(body) || !/settleMutation/.test(body)) {
    errors.push(`src/store.ts: ${name} must go through enqueueWrite and settleMutation`);
  }
}

// The page no longer applies mutation responses itself: the only
// replaceData(data.works, data.version, data.shipping) left is the manual
// refresh path; settled + re-read now lives in the store.
const refreshCount = (ui.match(/replaceData\(\s*data\.works\s*,\s*data\.version\s*,\s*data\.shipping\s*\)/g) || []).length;
if (refreshCount !== 1) {
  errors.push(`src/works-management.ts: expected exactly 1 replaceData(data.works, data.version, data.shipping) (manual refresh), found ${refreshCount}`);
}

const hasWorkItemCollection = /remote\.items|items\.values\(\)|filter\(entry => entry\.workId/.test(worker);
const hasDeleteGuard = /cannot|不可|不能|有收藏|收藏.*刪除|items.*workId|workId.*items/.test(worker);
if (!hasWorkItemCollection || !hasDeleteGuard) {
  errors.push('worker/src/index.ts: missing explicit work item-count handling');
}

// Phase 3-1 cross-tab sync (BroadcastChannel only, no polling). These are
// static contract checks: the live behaviour (two tabs, save in one, the
// other refreshes by itself) still needs the manual two-tab check — open
// the site in two tabs, save a shipping record in one, the other tab must
// show it without a manual refresh, and must not re-broadcast in a loop.
function bodyBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}
if (!/CROSS_TAB_CHANNEL = 'merch-mutation'/.test(store) || !/new BroadcastChannel\(CROSS_TAB_CHANNEL\)/.test(store)) {
  errors.push("src/store.ts: cross-tab sync must use BroadcastChannel('merch-mutation')");
}
if (!/typeof BroadcastChannel/.test(store)) {
  errors.push('src/store.ts: cross-tab sync must feature-detect BroadcastChannel and stay silent when unsupported');
}
if (/setInterval/.test(store)) {
  errors.push('src/store.ts: must not poll for cross-tab updates; use BroadcastChannel');
}
const applyRemoteBody = bodyBetween(store, 'private applyRemote(', 'private enqueueWrite');
if (!/broadcastMutation/.test(applyRemoteBody) || !/data\.version !== this\.state\.version/.test(applyRemoteBody) || !/source === 'local'/.test(applyRemoteBody)) {
  errors.push('src/store.ts: applyRemote must broadcast only when a local write actually changed the version');
}
const crossTabBody = bodyBetween(store, 'handleCrossTabMessage(', 'private applyRemote(');
if (!/enqueueWrite/.test(crossTabBody) || !/getAuthoritativeRemoteData/.test(crossTabBody)) {
  errors.push('src/store.ts: cross-tab reload must go through the write queue and re-read authoritative data');
}
if (!/data\.version === this\.state\.version/.test(crossTabBody) || !/applyRemote\(remote, 'remote'\)/.test(crossTabBody)) {
  errors.push('src/store.ts: cross-tab reload must skip when the version matches and must not re-broadcast');
}

if (!/editingId/.test(ui) || !/immutable|不可|不能|disabled/.test(ui)) {
  errors.push('src/works-management.ts: missing explicit edit-state / immutable work-code handling');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Works management CRUD contract: PASS');
