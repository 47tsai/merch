#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const assert = (condition, message) => {
  if (!condition) throw new Error(`API load verification failed: ${message}`);
};

const item = {
  id: 'TESTc001', workId: 'test-work', title: 'Test Item', series: [], characters: [], category: 'other', manufacturer: 'Test', quantity: 1, status: 'received', description: '', notes: '', purchase: {}, arrival: {}, afterSales: {}, images: [],
};
const collection = (shipping) => ({ version: '1.109.266', works: [{ id: 'test-work', name: 'Test Work', code: 'TEST', items: [item] }], shipping });
const apiResponse = (data) => ({ ok: true, data });
const makeResponse = (status, payload, jsonError = false) => ({ ok: status >= 200 && status < 300, status, async json() { if (jsonError) throw new Error('invalid json'); return payload; } });

const originalFetch = globalThis.fetch;
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merch-api-verify-'));
try {
  const apiSource = await fs.readFile(path.join(root, 'src', 'api.ts'), 'utf8');
  const validationSource = await fs.readFile(path.join(root, 'src', 'validation.ts'), 'utf8');
  const errorSource = await fs.readFile(path.join(root, 'src', 'error.ts'), 'utf8');
  const transpile = (source, fileName) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, verbatimModuleSyntax: true, sourceMap: false },
    fileName,
  }).outputText;

  await fs.writeFile(path.join(tempDir, 'error.mjs'), transpile(errorSource, 'error.ts'), 'utf8');
  await fs.writeFile(path.join(tempDir, 'validation.mjs'), transpile(validationSource, 'validation.ts'), 'utf8');
  const apiOutput = transpile(apiSource, 'api.ts')
    .replace("from './error'", "from './error.mjs'")
    .replace("from './sync-overlay'", "from './sync-overlay.mjs'")
    .replace("from './validation'", "from './validation.mjs'");
  await fs.writeFile(path.join(tempDir, 'api.mjs'), apiOutput, 'utf8');
  await fs.writeFile(path.join(tempDir, 'sync-overlay.mjs'), 'export async function runWithSync(_label, operation) { return operation(); }\n', 'utf8');

  globalThis.window = { setTimeout, clearTimeout };
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

  const load = async (responses) => {
    const calls = [];
    globalThis.fetch = async (input) => { const url = String(input); calls.push(url); const response = responses[url]; if (!response) throw new Error(`Unexpected fetch: ${url}`); return response; };
    const moduleUrl = `${pathToFileURL(path.join(tempDir, 'api.mjs')).href}?case=${Math.random()}`;
    const { getRemoteData } = await import(moduleUrl);
    const data = await getRemoteData();
    return { data, calls };
  };

  const staticShipping = [{ id: 'static-ship', amount: 10, currency: 'TWD', itemIds: [item.id] }];
  const collectionShipping = [{ id: 'collection-ship', amount: 20, currency: 'TWD', itemIds: [item.id] }];
  const workerShipping = [{ id: 'worker-ship', amount: 30, currency: 'TWD', itemIds: [item.id] }];

  let result = await load({ './data/collection.json': makeResponse(200, collection(collectionShipping)), './data/shipping.json': makeResponse(200, { schemaVersion: 1, records: staticShipping }) });
  assert(result.data.shipping[0].id === 'static-ship', 'valid static shipping must replace collection shipping');
  assert(result.calls.length === 2 && !result.calls.includes('/api/data'), 'successful static collection must not call Worker fallback');

  result = await load({ './data/collection.json': makeResponse(200, collection(collectionShipping)), './data/shipping.json': makeResponse(503, null) });
  assert(result.data.shipping[0].id === 'collection-ship', 'shipping fetch failure must not invalidate an otherwise valid collection');
  assert(!result.calls.includes('/api/data'), 'shipping-only failure must not trigger Worker collection fallback');

  result = await load({ './data/collection.json': makeResponse(503, null), '/api/data': makeResponse(200, apiResponse(collection(workerShipping))) });
  assert(result.data.shipping[0].id === 'worker-ship', 'collection fetch failure must use Worker /data fallback');
  assert(result.calls.includes('/api/data'), 'collection fetch failure must call Worker /data');

  result = await load({ './data/collection.json': makeResponse(200, collection(collectionShipping), true), '/api/data': makeResponse(200, apiResponse(collection(workerShipping))) });
  assert(result.data.shipping[0].id === 'worker-ship', 'invalid static collection JSON must use Worker /data fallback');
  assert(result.calls.includes('/api/data'), 'invalid static collection JSON must call Worker /data');

  result = await load({ './data/collection.json': makeResponse(200, { ...collection(collectionShipping), shipping: [{ id: 'broken', amount: -1, currency: 'TWD', itemIds: [item.id] }] }), '/api/data': makeResponse(200, apiResponse(collection(workerShipping))) });
  assert(result.data.shipping[0].id === 'worker-ship', 'invalid static collection schema must use Worker /data fallback');
  assert(result.calls.includes('/api/data'), 'invalid static collection schema must call Worker /data');

  console.log('API load verification passed: static collection, independent shipping load, shipping-only failure, and Worker /data fallback.');
} finally {
  if (originalFetch) globalThis.fetch = originalFetch; else delete globalThis.fetch;
  delete globalThis.window; delete globalThis.localStorage;
  await fs.rm(tempDir, { recursive: true, force: true });
}
