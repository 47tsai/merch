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
      GITHUB_REPO: 'tsai97216/merch',
      GITHUB_BRANCH: 'main',
      GITHUB_TOKEN: 'test-token',
      ADMIN_SECRET: 'test-admin-secret',
      MERCH_ASSETS: bucket,
    },
    store,
    calls,
  };
}

function deleteRequest({ authorization = 'Bearer test-admin-secret', requestOrigin = origin } = {}) {
  return new Request(assetUrl, {
    method: 'DELETE',
    headers: { Origin: requestOrigin, Authorization: authorization },
  });
}

function putRequest({ authorization = 'Bearer test-admin-secret', requestOrigin = origin } = {}) {
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
  globalThis.fetch = mock;
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
