#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const assert = (condition, message) => { if (!condition) throw new Error(`API mutation verification failed: ${message}`); };
const item = { id: 'TESTc001', workId: 'test-work', title: 'Test Item', series: [], characters: [], category: 'other', manufacturer: 'Test', quantity: 1, status: 'received', description: '', notes: '', purchase: {}, arrival: {}, afterSales: {}, images: [] };
const collection = (version = '1.109.857', items = [item]) => ({ version, works: [{ id: 'test-work', name: 'Test Work', code: 'TEST', items }], shipping: [] });
const makeResponse = (status, payload) => ({ ok: status >= 200 && status < 300, status, async json() { return payload; } });
const originalFetch = globalThis.fetch;
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merch-mutation-verify-'));

try {
  const apiSource = await fs.readFile(path.join(root, 'src', 'api.ts'), 'utf8');
  const validationSource = await fs.readFile(path.join(root, 'src', 'validation.ts'), 'utf8');
  const errorSource = await fs.readFile(path.join(root, 'src', 'error.ts'), 'utf8');
  const transpile = (source, fileName) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, verbatimModuleSyntax: true, sourceMap: false }, fileName }).outputText;
  await fs.writeFile(path.join(tempDir, 'error.mjs'), transpile(errorSource, 'error.ts'), 'utf8');
  await fs.writeFile(path.join(tempDir, 'validation.mjs'), transpile(validationSource, 'validation.ts'), 'utf8');
  await fs.writeFile(path.join(tempDir, 'sync-overlay.mjs'), 'export async function runWithSync(_label, operation) { return operation(); }\n', 'utf8');
  await fs.writeFile(path.join(tempDir, 'api.mjs'), transpile(apiSource, 'api.ts').replace("from './error'", "from './error.mjs'").replace("from './sync-overlay'", "from './sync-overlay.mjs'").replace("from './validation'", "from './validation.mjs'"), 'utf8');

  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.sessionStorage = { getItem: key => key === 'chi-auth-token' ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : null, setItem: () => {}, removeItem: () => {} };

  const run = async (operation, responses) => {
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      const response = responses[url];
      if (!response) throw new Error(`Unexpected fetch: ${url}`);
      return typeof response === 'function' ? response() : response;
    };
    const api = await import(`${pathToFileURL(path.join(tempDir, 'api.mjs')).href}?case=${Math.random()}`);
    return { result: await operation(api), calls };
  };

  let result = await run(api => api.putItem({ ...item, workName: 'Test Work' }), {
    '/api/auth/status': makeResponse(200, { ok: true, data: { authenticated: true } }),
    '/api/items/TESTc001': makeResponse(200, { ok: true, data: { version: '1.109.858' } }),
    '/api/data': makeResponse(200, { ok: true, data: collection('1.109.858') }),
  });
  assert(result.result.submitted === true, 'PUT Item must resolve as submitted without requiring the final response');
  const putBody = JSON.parse(result.calls.find(call => call.url === '/api/items/TESTc001').init.body);
  assert(!('workName' in putBody.item), 'PUT Item must not persist runtime workName');
  const settled = await result.result.settled;
  assert(settled.version === '1.109.858', 'submitted mutation must still reconcile with authoritative remote data in the background');
  assert(result.calls.filter(call => call.url === '/api/auth/status').length === 1, 'first mutation must verify management authentication');
  assert(result.calls.filter(call => call.url === '/api/data').length === 1, 'background reconciliation must fetch authoritative API data exactly once');

  result = await run(api => api.putShipping({ id: 'ship-1', amount: 25, currency: 'TWD', itemIds: ['TESTc001'] }), {
    '/api/auth/status': makeResponse(200, { ok: true, data: { authenticated: true } }),
    '/api/shipping/ship-1': makeResponse(200, { ok: true, data: { version: '1.109.859' } }),
    '/api/data': makeResponse(200, { ok: true, data: collection('1.109.859') }),
  });
  assert(result.result.submitted === true, 'PUT Shipping must resolve as submitted');
  const shippingBody = JSON.parse(result.calls.find(call => call.url === '/api/shipping/ship-1').init.body);
  assert(shippingBody.shipping.id === 'ship-1' && shippingBody.shipping.itemIds[0] === 'TESTc001', 'PUT Shipping must preserve its canonical relation');
  await result.result.settled;

  result = await run(api => api.putAsset('data/test-work/other/TESTc001/images/TESTc001.png', 'BASE64'), {
    '/api/auth/status': makeResponse(200, { ok: true, data: { authenticated: true } }),
    '/api/assets/data/test-work/other/TESTc001/images/TESTc001.png': makeResponse(200, { ok: true, data: { path: 'data/test-work/other/TESTc001/images/TESTc001.png', replaced: false, version: '1.109.860' } }),
  });
  assert(result.result.submitted === true, 'image upload must resolve as submitted');
  const asset = await result.result.settled;
  assert(asset.replaced === false, 'image mutation must still validate its background response');

  globalThis.navigator.onLine = false;
  let failed = false;
  try {
    await run(api => api.putItem(item), { '/api/auth/status': makeResponse(200, { ok: true, data: { authenticated: true } }) });
  } catch { failed = true; }
  assert(failed, 'offline mutations must not be submitted');

  console.log('API mutation verification passed: management-authenticated online mutations complete on submission, with background reconciliation.');
} finally {
  if (originalFetch) globalThis.fetch = originalFetch; else delete globalThis.fetch;
  delete globalThis.window;
  delete globalThis.localStorage;
  try { delete globalThis.navigator; } catch {}
  await fs.rm(tempDir, { recursive: true, force: true });
}
