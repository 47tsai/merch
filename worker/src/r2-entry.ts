import app from './index';
import { deleteR2Asset, getR2Asset, putR2Asset } from './r2-assets';

interface Env {
  ALLOWED_ORIGIN: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_TOKEN: string;
  ADMIN_SECRET: string;
  MERCH_ASSETS: R2Bucket;
}

type AssetRequest = { path?: unknown; content?: unknown };

const WORKER_VERSION = '1.109.854';
const ASSET_RE = /^data\/[^/]+\/[a-z]\/[^/]+\/images\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp|gif|avif)$/i;

function assetContentType(path: string): string {
  const ext = path.toLowerCase().split('.').pop();
  return ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'avif' ? 'image/avif' : 'image/jpeg';
}

function corsResponse(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  headers.set('X-Merch-Worker-Version', WORKER_VERSION);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function authorized(request: Request, env: Env): boolean {
  return Boolean(env.ADMIN_SECRET) && request.headers.get('Authorization') === `Bearer ${env.ADMIN_SECRET}`;
}

function originFor(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  return !origin || origin === env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知錯誤。';
}

function errorResponse(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Merch-Worker-Version': WORKER_VERSION },
  });
}

function r2AssetPath(request: Request): string | null {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/assets/')) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice('/api/assets/'.length));
  } catch {
    return null;
  }
  return ASSET_RE.test(path) && !path.includes('..') ? path : null;
}

async function getFromR2(env: Env, origin: string, path: string): Promise<Response | null> {
  const asset = await getR2Asset(env.MERCH_ASSETS, path);
  if (!asset?.body) return null;
  const headers = new Headers({
    'Content-Type': asset.httpMetadata?.contentType || assetContentType(path),
    'Cache-Control': asset.httpMetadata?.cacheControl || 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'X-Merch-Asset-Source': 'r2',
    'X-Merch-Worker-Version': WORKER_VERSION,
  });
  if (asset.etag) headers.set('ETag', asset.etag);
  return new Response(asset.body, { status: 200, headers });
}

async function readAssetRequest(request: Request, path: string): Promise<{ bodyText: string; bytes: Uint8Array }> {
  const bodyText = await request.text();
  let body: AssetRequest;
  try {
    body = JSON.parse(bodyText) as AssetRequest;
  } catch {
    throw new Error('圖片資料格式無效。');
  }
  if (body.path !== path || typeof body.content !== 'string' || !body.content) throw new Error('圖片資料格式無效。');
  try {
    const binary = atob(body.content.replace(/\s/g, ''));
    return { bodyText, bytes: Uint8Array.from(binary, char => char.charCodeAt(0)) };
  } catch {
    throw new Error('圖片 Base64 資料無效。');
  }
}

async function readCurrentAssetFromR2(env: Env, path: string): Promise<Uint8Array | null> {
  const asset = await getR2Asset(env.MERCH_ASSETS, path);
  if (!asset?.body) return null;
  return new Uint8Array(await new Response(asset.body).arrayBuffer());
}

async function readPreviousAssetWithRetry(env: Env, path: string): Promise<Uint8Array | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await readCurrentAssetFromR2(env, path);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('R2 previous asset read failed.');
}

async function mirrorPut(request: Request, env: Env, path: string): Promise<Response> {
  let parsed: { bodyText: string; bytes: Uint8Array };
  try {
    parsed = await readAssetRequest(request, path);
  } catch (error) {
    return errorResponse('ASSET_INVALID', errorMessage(error), 400);
  }

  let previous: Uint8Array | null = null;
  try {
    previous = await readPreviousAssetWithRetry(env, path);
  } catch (error) {
    console.error('Failed to read previous image from R2 before mirror PUT after retries.', error);
    return errorResponse('R2_PREVIOUS_READ_FAILED', `無法讀取既有圖片，尚未寫入 R2 或 GitHub：${errorMessage(error)}`, 502);
  }

  try {
    await putR2Asset(env.MERCH_ASSETS, path, parsed.bytes, assetContentType(path));
    const stored = await env.MERCH_ASSETS.head(path);
    if (!stored || stored.size !== parsed.bytes.byteLength) throw new Error(`R2 mirror verification failed for ${path}.`);
  } catch (error) {
    console.error('R2 image mirror PUT failed before GitHub mutation.', error);
    return errorResponse('R2_MIRROR_FAILED', `圖片已處理，但 R2 儲存失敗，尚未寫入 GitHub：${errorMessage(error)}`, 502);
  }

  let response: Response;
  try {
    const mutationRequest = new Request(request.url, {
      method: 'PUT',
      headers: request.headers,
      body: parsed.bodyText,
    });
    response = await app.fetch(mutationRequest, env);
  } catch (error) {
    console.error('GitHub image mutation threw an exception.', error);
    try {
      if (previous) await putR2Asset(env.MERCH_ASSETS, path, previous, assetContentType(path));
      else await deleteR2Asset(env.MERCH_ASSETS, path);
    } catch (rollbackError) {
      console.error('R2 image mirror rollback failed after GitHub request error.', rollbackError);
      return errorResponse('GITHUB_MUTATION_FAILED_ROLLBACK_FAILED', `GitHub 圖片寫入失敗，且 R2 rollback 也失敗：${errorMessage(error)}`, 502);
    }
    return errorResponse('GITHUB_MUTATION_FAILED', `GitHub 圖片寫入失敗，R2 已 rollback：${errorMessage(error)}`, 502);
  }

  if (!response.ok) {
    try {
      if (previous) await putR2Asset(env.MERCH_ASSETS, path, previous, assetContentType(path));
      else await deleteR2Asset(env.MERCH_ASSETS, path);
    } catch (rollbackError) {
      console.error('R2 image mirror rollback failed after GitHub mutation failure.', rollbackError);
      return errorResponse('GITHUB_RESPONSE_FAILED_ROLLBACK_FAILED', `GitHub 圖片寫入回應失敗，且 R2 rollback 也失敗：${errorMessage(rollbackError)}`, 502);
    }
  }

  return response;
}

async function mirrorDelete(request: Request, env: Env, path: string): Promise<Response> {
  let previous: Uint8Array | null = null;
  try {
    previous = await readPreviousAssetWithRetry(env, path);
  } catch (error) {
    console.error('Failed to read previous image from R2 before mirror DELETE after retries.', error);
    return errorResponse('R2_PREVIOUS_READ_FAILED', `無法讀取既有圖片，尚未刪除 R2 或 GitHub：${errorMessage(error)}`, 502);
  }

  if (previous) {
    try {
      await deleteR2Asset(env.MERCH_ASSETS, path);
      const stored = await env.MERCH_ASSETS.head(path);
      if (stored) throw new Error(`R2 delete verification failed for ${path}.`);
    } catch (error) {
      console.error('R2 image mirror DELETE failed before GitHub mutation.', error);
      return errorResponse('R2_MIRROR_DELETE_FAILED', `R2 圖片刪除失敗，尚未刪除 GitHub：${errorMessage(error)}`, 502);
    }
  }

  let response: Response;
  try {
    response = await app.fetch(request, env);
  } catch (error) {
    console.error('GitHub image deletion threw an exception.', error);
    try {
      if (previous) await putR2Asset(env.MERCH_ASSETS, path, previous, assetContentType(path));
    } catch (rollbackError) {
      console.error('R2 image mirror rollback failed after GitHub delete request error.', rollbackError);
      return errorResponse('GITHUB_DELETE_FAILED_ROLLBACK_FAILED', `GitHub 圖片刪除失敗，且 R2 rollback 也失敗：${errorMessage(error)}`, 502);
    }
    return errorResponse('GITHUB_DELETE_FAILED', `GitHub 圖片刪除失敗，R2 已 rollback：${errorMessage(error)}`, 502);
  }

  if (!response.ok) {
    try {
      if (previous) await putR2Asset(env.MERCH_ASSETS, path, previous, assetContentType(path));
    } catch (rollbackError) {
      console.error('R2 image mirror rollback failed after GitHub delete failure.', rollbackError);
      return errorResponse('GITHUB_DELETE_RESPONSE_FAILED_ROLLBACK_FAILED', `GitHub 圖片刪除失敗，且 R2 rollback 也失敗：${errorMessage(rollbackError)}`, 502);
    }
  }

  return response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = originFor(request, env);
    if (!origin) return errorResponse('ORIGIN_NOT_ALLOWED', '來源網域不被允許。', 403);

    const path = r2AssetPath(request);
    if (path && request.method === 'GET') {
      const r2Response = await getFromR2(env, origin, path);
      if (r2Response) return r2Response;
    }

    if (path && (request.method === 'PUT' || request.method === 'DELETE')) {
      if (!authorized(request, env)) {
        return corsResponse(errorResponse('UNAUTHORIZED', '需要管理員權限。', 401), origin);
      }
      if (request.method === 'PUT') {
        return corsResponse(await mirrorPut(request, env, path), origin);
      }
      return corsResponse(await mirrorDelete(request, env, path), origin);
    }

    return corsResponse(await app.fetch(request, env), origin);
  },
};
