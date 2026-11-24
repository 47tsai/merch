import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['worker/src/r2-entry.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`;
const { default: worker } = await import(moduleUrl);

const assetPath = 'data/test-work/a/ABCd001/images/test.png';
const assetUrl = `https://merch.chi.qzz.io/api/assets/${assetPath}`;
const origin = 'https://merch.chi.qzz.io';
const body = JSON.stringify({ path: assetPath, content: 'AQID' });
const previousBytes = new Uint8Array([9, 8, 7]);

function makeEnv(options = {}) {
  const store = new Map();
  if (options.previous) store.set(assetPath, new Uint8Array(options.previous));
  const calls = { get: 0, put: 0, delete: 0, head: 0 };
  const bucket = {
    async get(key) {
      calls.get += 1;
      if (options.failGet) throw new Error('R2 read unavailable');
      const value = store.get(key);
      if (!value) return null;
      return {
        body: new Response(value).body,
        size: value.byteLength,
        httpEtag: '"test-etag"',
        httpMetadata: { contentType: 'image/png' },
      };
    },
    async put(key, value) {
      calls.put += 1;
      if ((options.failPutAt ?? []).includes(calls.put)) throw new Error('R2 write unavailable');
      store.set(key, new Uint8Array(value));
    },
    async delete(key) {
      calls.delete += 1;
      if (options.failDelete) throw new Error('R2 delete unavailable');
      store.delete(key);
    },
    async head(key) {
      calls.head += 1;
      const value = store.get(key);
      return value ? { size: value.byteLength } : null;
    },
  };
  return {
    env: {
      ALLOWED_ORIGIN: origin,
      GITHUB_REPO: '47tsai/merch',
      GITHUB_BRANCH: 'main',
      GITHUB_TOKEN: 'test-token',
      CHI_AUTH_URL: 'https://auth.chi.qzz.io',
      CHI_AUTH_CLIENT_ID: 'test-client-id',
      MERCH_ASSETS: bucket,
    },
    store,
    calls,
  };
}

function deleteRequest({ authorization = 'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', requestOrigin = origin } = {}) {
  return new Request(assetUrl, {
    method: 'DELETE',
    headers: { Origin: requestOrigin, Authorization: authorization },
  });
}

function putRequest({ authorization = 'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', requestOrigin = origin } = {}) {
  return new Request(assetUrl, {
    method: 'PUT',
    headers: {
      Origin: requestOrigin,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body,
  });
}

async function withFetch(mock, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input.url);
    if (target.pathname === '/api/userinfo' && target.searchParams.get('client_id') === 'test-client-id') {
      return new Response(JSON.stringify({ sub: ['chi', 'owner'].join('-'), aud: 'test-client-id' }), { status: 200 });
    }
    return mock(input, init);
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('unauthorized image PUT returns 401 before touching R2 or GitHub', async () => {
  const { env, calls } = makeEnv({ previous: previousBytes });
  let githubCalls = 0;
  const response = await withFetch(async () => {
    githubCalls += 1;
    throw new Error('GitHub must not be called');
  }, () => worker.fetch(putRequest({ authorization: 'Bearer wrong-secret' }), env));

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
  assert.equal(calls.get, 0);
  assert.equal(calls.put, 0);
  assert.equal(calls.delete, 0);
  assert.equal(githubCalls, 0);
});

test('R2 previous-object read failure stops the write before GitHub mutation', async () => {
  const { env, calls } = makeEnv({ failGet: true });
  let githubCalls = 0;
  const response = await withFetch(async () => {
    githubCalls += 1;
    throw new Error('GitHub must not be called');
  }, () => worker.fetch(putRequest(), env));

  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'R2_PREVIOUS_READ_FAILED');
  assert.equal(calls.get, 3, 'R2 read should use the configured three attempts');
  assert.equal(calls.put, 0);
  assert.equal(githubCalls, 0);
});

test('GitHub API failure rolls the R2 mirror back to the previous bytes', async () => {
  const { env, store, calls } = makeEnv({ previous: previousBytes });
  const response = await withFetch(async () => new Response('{"message":"upstream unavailable"}', { status: 500 }), () =>
    worker.fetch(putRequest(), env));

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'GITHUB_API_ERROR');
  assert.deepEqual([...store.get(assetPath)], [...previousBytes]);
  assert.equal(calls.put, 2, 'one write plus one rollback should occur');
});

test('rollback failure returns a distinct error instead of hiding mirror divergence', async () => {
  const { env, store, calls } = makeEnv({ previous: previousBytes, failPutAt: [2] });
  const response = await withFetch(async () => new Response('{"message":"upstream unavailable"}', { status: 500 }), () =>
    worker.fetch(putRequest(), env));

  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'GITHUB_RESPONSE_FAILED_ROLLBACK_FAILED');
  assert.equal(calls.put, 2);
  assert.deepEqual([...store.get(assetPath)], [1, 2, 3], 'test should expose the new mirror bytes left behind by failed rollback');
});

test('disallowed Origin is rejected before any R2 access', async () => {
  const { env, calls } = makeEnv({ previous: previousBytes });
  const response = await worker.fetch(putRequest({ requestOrigin: 'https://attacker.example' }), env);

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(calls.get, 0);
  assert.equal(calls.put, 0);
  assert.equal(calls.delete, 0);
});


test('R2 delete failure stops before GitHub mutation', async () => {
  const { env, store, calls } = makeEnv({ previous: previousBytes, failDelete: true });
  let githubCalls = 0;
  const response = await withFetch(async () => {
    githubCalls += 1;
    throw new Error('GitHub must not be called');
  }, () => worker.fetch(deleteRequest(), env));

  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'R2_MIRROR_DELETE_FAILED');
  assert.deepEqual([...store.get(assetPath)], [...previousBytes]);
  assert.equal(calls.delete, 1);
  assert.equal(githubCalls, 0);
});

test('GitHub delete API failure restores the R2 mirror', async () => {
  const { env, store, calls } = makeEnv({ previous: previousBytes });
  const response = await withFetch(async () => new Response('{"message":"upstream unavailable"}', { status: 500 }), () =>
    worker.fetch(deleteRequest(), env));

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'GITHUB_API_ERROR');
  assert.deepEqual([...store.get(assetPath)], [...previousBytes]);
  assert.equal(calls.delete, 1);
  assert.equal(calls.put, 1, 'rollback should restore the previous object once');
});

test('failed delete rollback returns an explicit divergence error', async () => {
  const { env, store, calls } = makeEnv({ previous: previousBytes, failPutAt: [1] });
  const response = await withFetch(async () => new Response('{"message":"upstream unavailable"}', { status: 500 }), () =>
    worker.fetch(deleteRequest(), env));

  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'GITHUB_DELETE_RESPONSE_FAILED_ROLLBACK_FAILED');
  assert.equal(store.has(assetPath), false, 'failed rollback leaves the mirror object absent');
  assert.equal(calls.delete, 1);
  assert.equal(calls.put, 1);
});

function makeShippingGithubMock({ dispatchFails = false } = {}) {
  const worksJson = JSON.stringify({ schemaVersion: 2, works: [{ id: 'honkai-star-rail', name: '崩壞：星穹鐵道', code: 'HSR', path: 'data/honkai-star-rail' }] });
  const versionJson = JSON.stringify({ version: '2.0.45' });
  const packageJson = JSON.stringify({ version: '2.0.45' });
  const shippingJson = JSON.stringify({ schemaVersion: 1, records: [
    { id: 'ship-mtqm9317', amount: 73, currency: 'TWD', date: '2026-08-14', carrier: '台集運', itemIds: ['HSRf001'] },
    { id: 'ship-20260916-001', amount: 94, currency: 'TWD', date: '2026-05-09', carrier: '全統路跑', itemIds: ['HSRo001'] },
  ] });
  const categoryJson = JSON.stringify({ schemaVersion: 1, workId: 'honkai-star-rail', category: 'k', items: [{ id: 'HSRk001', path: 'data/honkai-star-rail/k/HSRk001/data.json', title: 'test' }] });
  const itemJson = JSON.stringify({ id: 'HSRk001', workId: 'honkai-star-rail', title: 'test', series: [], characters: [], category: 'k', manufacturer: 'test', quantity: 1, status: 'received', description: '', notes: '', purchase: {}, arrival: {}, afterSales: {}, images: [] });
  const treeJson = JSON.stringify({ sha: 'tree-sha-1', truncated: false, tree: [
    { path: 'data/works.json', type: 'blob', sha: 'sha-works' },
    { path: 'public/data/version.json', type: 'blob', sha: 'sha-version' },
    { path: 'package.json', type: 'blob', sha: 'sha-package' },
    { path: 'public/data/shipping.json', type: 'blob', sha: 'sha-shipping' },
    { path: 'data/honkai-star-rail/k/index.json', type: 'blob', sha: 'sha-category' },
    { path: 'data/honkai-star-rail/k/HSRk001/data.json', type: 'blob', sha: 'sha-item' },
  ] });
  let githubCalls = 0;
  let committedShipping = null;
  const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status });
  const mock = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== 'api.github.com') throw new Error(`Unexpected host: ${url.hostname}`);
    githubCalls += 1;
    if (url.pathname === '/graphql' && (init.method || 'GET') === 'POST') {
      const query = JSON.parse(String(init.body)).query;
      if (query.includes('ref(qualifiedName')) return json({ data: { repository: { ref: { target: { oid: 'head-sha-1', tree: { oid: 'tree-sha-1' } } } } } });
      if (query.includes('index.json')) return json({ data: { repository: { b0: { text: worksJson }, b1: { text: versionJson }, b2: { text: packageJson }, b3: { text: shippingJson }, c0: { text: categoryJson } } } });
      return json({ data: { repository: { i0: { text: itemJson } } } });
    }
    if (url.pathname === '/repos/47tsai/merch/git/trees/tree-sha-1') return new Response(treeJson, { status: 200 });
    if (url.pathname === '/repos/47tsai/merch/git/blobs' && init.method === 'POST') {
      // Capture what the commit actually writes, so the test can check the
      // persisted data instead of trusting the mutation response.
      try {
        const written = JSON.parse(String(JSON.parse(String(init.body)).content));
        if (written && Array.isArray(written.records)) committedShipping = written;
      } catch { /* not a JSON blob; ignore */ }
      return json({ sha: 'new-blob-sha' }, 201);
    }
    if (url.pathname === '/repos/47tsai/merch/git/trees' && init.method === 'POST') return json({ sha: 'new-tree-sha' }, 201);
    if (url.pathname === '/repos/47tsai/merch/git/commits' && init.method === 'POST') return json({ sha: 'new-commit-sha', tree: { sha: 'new-tree-sha' } }, 201);
    if (url.pathname === '/repos/47tsai/merch/git/refs/heads/main' && init.method === 'PATCH') return json({ object: { sha: 'new-commit-sha' } });
    if (url.pathname === '/repos/47tsai/merch/dispatches' && init.method === 'POST') {
      if (dispatchFails) return new Response(null, { status: 500 });
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected GitHub call: ${init.method || 'GET'} ${url.pathname}`);
  };
  return { mock, getGithubCalls: () => githubCalls, getCommittedShipping: () => committedShipping };
}

function shippingPutRequest() {
  return new Request('https://merch.chi.qzz.io/api/shipping/ship-test', {
    method: 'PUT',
    headers: { Origin: origin, Authorization: `Bearer ${'a'.repeat(43)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipping: { id: 'ship-test', amount: 72, currency: 'TWD', date: '2026-11-23', carrier: '測試', itemIds: ['HSRk001'] } }),
  });
}

test('shipping PUT stays within the free-plan subrequest budget', async () => {
  const { env } = makeEnv();
  const { mock, getGithubCalls, getCommittedShipping } = makeShippingGithubMock();
  const response = await withFetch(mock, () => worker.fetch(shippingPutRequest(), env));
  const payload = await response.json();
  assert.equal(response.status, 200, `shipping PUT must succeed, got ${JSON.stringify(payload)}`);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.version, '2.0.46');
  // Mutations return only the new version now; the frontend re-reads
  // /api/data for the full state. The persisted data is checked on the
  // commit payload itself: 3 records, including the new 72 TWD one.
  assert.deepEqual(Object.keys(payload.data), ['version']);
  const committed = getCommittedShipping();
  assert.equal(committed?.records.length, 3);
  assert.equal(committed?.records.find(x => x.id === 'ship-test')?.amount, 72);
  assert.ok(getGithubCalls() <= 20, `shipping PUT must stay within the free-plan subrequest budget, made ${getGithubCalls()} GitHub calls`);
});

test('shipping PUT still succeeds when the Verify dispatch fails', async () => {
  const { env } = makeEnv();
  const { mock, getCommittedShipping } = makeShippingGithubMock({ dispatchFails: true });
  const response = await withFetch(mock, () => worker.fetch(shippingPutRequest(), env));
  const payload = await response.json();
  assert.equal(response.status, 200, `shipping PUT must succeed even when dispatch fails, got ${JSON.stringify(payload)}`);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.version, '2.0.46');
  assert.deepEqual(Object.keys(payload.data), ['version']);
  const committed = getCommittedShipping();
  assert.equal(committed?.records.length, 3);
  assert.equal(committed?.records.find(x => x.id === 'ship-test')?.amount, 72);
});

test('unchanged Item update returns the current version without creating a commit', async () => {
  const { env } = makeEnv();
  const item = { id: 'HSRk001', workId: 'honkai-star-rail', title: 'test', series: [], characters: [], category: 'k', manufacturer: 'test', quantity: 1, status: 'received', description: '', notes: '', purchase: {}, arrival: {}, afterSales: {}, images: [] };
  const worksJson = JSON.stringify({ schemaVersion: 2, works: [{ id: 'honkai-star-rail', name: '崩壞：星穹鐵道', code: 'HSR', path: 'data/honkai-star-rail' }] });
  const versionJson = JSON.stringify({ version: '2.0.45' });
  const packageJson = JSON.stringify({ version: '2.0.45' });
  const shippingJson = JSON.stringify({ schemaVersion: 1, records: [] });
  const categoryJson = JSON.stringify({ schemaVersion: 1, workId: 'honkai-star-rail', category: 'k', items: [{ id: 'HSRk001', path: 'data/honkai-star-rail/k/HSRk001/data.json', title: 'test' }] });
  const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status });
  const content = (text, sha) => json({ type: 'file', content: Buffer.from(text).toString('base64'), encoding: 'base64', sha });
  const mock = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== 'api.github.com') throw new Error(`Unexpected host: ${url.hostname}`);
    const method = init.method || 'GET';
    if (method !== 'GET') throw new Error(`Unchanged update must not issue any GitHub write, got ${method} ${url.pathname}`);
    if (url.pathname === '/repos/47tsai/merch/git/ref/heads/main') return json({ object: { sha: 'head-sha-1' } });
    if (url.pathname === '/repos/47tsai/merch/git/commits/head-sha-1') return json({ sha: 'head-sha-1', tree: { sha: 'tree-sha-1' } });
    if (url.pathname === '/repos/47tsai/merch/contents/data/works.json') return content(worksJson, 'sha-works');
    if (url.pathname === '/repos/47tsai/merch/contents/public/data/version.json') return content(versionJson, 'sha-version');
    if (url.pathname === '/repos/47tsai/merch/contents/package.json') return content(packageJson, 'sha-package');
    if (url.pathname === '/repos/47tsai/merch/contents/public/data/shipping.json') return content(shippingJson, 'sha-shipping');
    if (url.pathname === '/repos/47tsai/merch/contents/data/honkai-star-rail') return json([{ type: 'dir', name: 'k' }]);
    if (url.pathname === '/repos/47tsai/merch/contents/data/honkai-star-rail/k/index.json') return content(categoryJson, 'sha-category');
    if (url.pathname === '/repos/47tsai/merch/contents/data/honkai-star-rail/k/HSRk001/data.json') return content(JSON.stringify(item), 'sha-item');
    if (url.pathname === '/repos/47tsai/merch/contents/data/honkai-star-rail/k/HSRk001/images') return json([]);
    throw new Error(`Unexpected GitHub call: ${method} ${url.pathname}`);
  };
  const request = new Request('https://merch.chi.qzz.io/api/items/HSRk001', {
    method: 'PUT',
    headers: { Origin: origin, Authorization: `Bearer ${'a'.repeat(43)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item }),
  });
  const response = await withFetch(mock, () => worker.fetch(request, env));
  const payload = await response.json();
  assert.equal(response.status, 200, `unchanged update must succeed, got ${JSON.stringify(payload)}`);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.version, '2.0.45', 'unchanged update must not bump the version');
});
