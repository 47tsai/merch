import type { Item, StoreState, Work } from './types';
import { dataError } from './error';
import { runWithSync } from './sync-overlay';
import { isRecord, isStringArray, isValidImage, isValidItem, isValidShipping } from './validation';

type ApiResponse = { ok: boolean; data?: unknown; error?: { code?: string; message?: string } };
type ApiData = Pick<StoreState, 'works' | 'version' | 'shipping'>;
type ImportMetaWithEnv = ImportMeta & { env?: { VITE_MERCH_API_URL?: string } };
type AuthStatus = { authenticated: boolean };
type ApiFailure = { apiCode?: string; status: number; workerVersion?: string };
type AssetResult = { path: string; replaced: boolean; version: string };
type MutationResult = { version: string };
export type MutationSubmission<T> = { submitted: true; settled: Promise<T> };
type AssetDeleteResult = { path: string; deleted: boolean; version: string };
type WorkPayload = { id?: string; name: string; code: string };

const meta = import.meta as ImportMetaWithEnv;
const API_BASE = (meta.env?.VITE_MERCH_API_URL || '/api').replace(/\/$/, '');
const API_TIMEOUT_MS = 12_000;
const FORBIDDEN_STORAGE_FIELDS = ['workName', 'shipping', 'material', 'release', 'createdAt', 'updatedAt'] as const;
let mutationQueue: Promise<void> = Promise.resolve();
let managementVerified = false;
let sessionAccessToken = (() => { try { const token = sessionStorage.getItem('chi-auth-token') || ''; sessionStorage.removeItem('chi-auth-token'); return token; } catch { return ''; } })();
function endpoint(path: string): string { return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`; }
function authToken(): string { return sessionAccessToken; }
async function ensureMutationReady(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw dataError('目前沒有網路連線，無法送出操作。');
  if (!hasChiAuthToken()) { managementVerified = false; throw dataError('尚未完成管理驗證，無法送出操作。'); }
  if (managementVerified) return;
  const status = await getAuthStatus();
  if (!status.authenticated) throw dataError('管理驗證已失效，請重新驗證。');
}
function resetManagementVerification(): void { managementVerified = false; }

function toStorageItem(item: Item): Item { const copy = structuredClone(item) as Item & Record<string, unknown>; for (const field of FORBIDDEN_STORAGE_FIELDS) delete copy[field]; return copy; }
async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers); headers.set('Accept', 'application/json'); if (init.body) headers.set('Content-Type', 'application/json'); const token = authToken(); if (token) headers.set('Authorization', `Bearer ${token}`);
  const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS); let response: Response;
  try { response = await fetch(endpoint(path), { ...init, headers, cache: 'no-store', signal: controller.signal }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw dataError('API 請求逾時，請稍後再試。'); throw dataError('API 網路連線失敗，請稍後再試。'); }
  finally { window.clearTimeout(timer); }
  let payload: ApiResponse | null = null; try { payload = await response.json() as ApiResponse; } catch {}
  if (!response.ok || !payload?.ok) {
    const workerVersion = response.headers.get('X-Merch-Worker-Version') || undefined;
    const failure: ApiFailure = { apiCode: payload?.error?.code, status: response.status, workerVersion };
    const message = payload?.error?.message || `API 請求失敗（${response.status}）`;
    const detail = [failure.apiCode, `HTTP ${failure.status}`, workerVersion ? `Worker ${workerVersion}` : ''].filter(Boolean).join(' · ');
    throw dataError(`${message}${detail ? ` [${detail}]` : ''}`, failure);
  }
  return payload.data;
}
function validateImage(value: unknown): void { if (!isValidImage(value)) throw dataError('API 回傳圖片資料格式無效。'); }
function validateItem(value: unknown): value is Item { if (!isValidItem(value)) return false; return true; }
function validateWork(value: unknown): value is Work { if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || typeof value.code !== 'string' || !value.code.trim() || !Array.isArray(value.items) || !value.items.every(validateItem)) return false; return value.items.every(item => item.workId === value.id); }
function validateShipping(value: unknown): boolean { return isValidShipping(value); }
function validateShippingList(value: unknown): StoreState['shipping'] { if (!Array.isArray(value)) throw dataError('API 回傳運費資料格式無效。'); const ids = new Set<string>(); for (const record of value) { if (!validateShipping(record)) throw dataError('API 回傳運費資料格式無效。'); const id = (record as { id: string }).id; if (ids.has(id)) throw dataError(`API 回傳運費 ID 重複：${id}`); ids.add(id); } return value as StoreState['shipping']; }
function validateMutationResult(data: unknown): MutationResult {
  if (isRecord(data) && typeof data.version === 'string' && /^\d+\.\d+\.\d+$/.test(data.version)) return { version: data.version };
  if (isRecord(data) && Array.isArray(data.works) && Array.isArray(data.shipping) && typeof data.version === 'string' && /^\d+\.\d+\.\d+$/.test(data.version)) return { version: data.version };
  throw dataError('API 回傳 mutation 結果格式無效。');
}
function validateData(data: unknown): ApiData { if (!isRecord(data) || typeof data.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version) || !Array.isArray(data.works) || !data.works.every(validateWork) || !Array.isArray(data.shipping) || !data.shipping.every(validateShipping)) throw dataError('API 回傳資料格式無效。'); const itemIds = new Set<string>(); for (const work of data.works as Work[]) for (const item of work.items) { if (itemIds.has(item.id)) throw dataError(`API 回傳 Item ID 重複：${item.id}`); itemIds.add(item.id); } const shipping = validateShippingList(data.shipping); for (const record of shipping) for (const itemId of record.itemIds) if (!itemIds.has(itemId)) throw dataError(`API 回傳 Shipping 關聯不存在的 Item：${itemId}`); return { works: data.works as Work[], version: data.version, shipping }; }
function validateAuthStatus(data: unknown): AuthStatus { if (!data || typeof data !== 'object' || typeof (data as { authenticated?: unknown }).authenticated !== 'boolean') throw dataError('API 驗證狀態格式無效。'); return data as AuthStatus; }
function validateAssetResult(data: unknown): AssetResult { if (!data || typeof data !== 'object') throw dataError('API 回傳圖片資料格式無效。'); const value = data as Partial<AssetResult>; if (typeof value.path !== 'string' || typeof value.replaced !== 'boolean' || typeof value.version !== 'string') throw dataError('API 回傳圖片資料格式無效。'); return value as AssetResult; }
function validateAssetDeleteResult(data: unknown): AssetDeleteResult { if (!data || typeof data !== 'object') throw dataError('API 回傳圖片刪除結果格式無效。'); const value = data as Partial<AssetDeleteResult>; if (typeof value.path !== 'string' || value.deleted !== true || typeof value.version !== 'string') throw dataError('API 回傳圖片刪除結果格式無效。'); return value as AssetDeleteResult; }
async function getStaticShipping(): Promise<StoreState['shipping'] | null> { try { const response = await fetch('./data/shipping.json', { cache: 'no-store' }); if (!response.ok) return null; const payload = await response.json(); if (!isRecord(payload) || payload.schemaVersion !== 1) return null; return validateShippingList(payload.records); } catch { return null; } }
export async function getRemoteData(): Promise<ApiData> { try { const response = await fetch('./data/collection.json', { cache: 'no-store' }); if (response.ok) { const data = validateData(await response.json()); const shipping = await getStaticShipping(); return shipping ? { ...data, shipping } : data; } } catch {} return validateData(await request('/data')); }
export async function getAuthoritativeRemoteData(): Promise<ApiData> { return validateData(await request('/data')); }
function mutationLabel(method: string): string { if (method === 'DELETE') return '正在刪除並同步資料…'; if (method === 'PUT' || method === 'PATCH') return '正在編輯並同步資料…'; if (method === 'POST') return '正在新增並同步資料…'; return '正在同步資料…'; }
async function mutateSubmitted<T>(method: string, start: () => Promise<T>): Promise<MutationSubmission<T>> {
  const started = mutationQueue.then(async () => {
    await ensureMutationReady();
    return { settled: start() };
  }, async () => {
    await ensureMutationReady();
    return { settled: start() };
  });
  mutationQueue = started.then(
    ({ settled }) => settled.then(() => undefined, () => undefined),
    () => undefined,
  );
  const { settled } = await runWithSync(mutationLabel(method), () => started);
  return { submitted: true, settled };
}
export async function putItem(item: Item): Promise<MutationSubmission<ApiData>> { return mutateSubmitted('PUT', () => request(`/items/${encodeURIComponent(item.id)}`, { method: 'PUT', body: JSON.stringify({ item: toStorageItem(item) }) }).then(validateMutationResult).then(() => getAuthoritativeRemoteData())); }
export async function deleteItem(id: string): Promise<MutationSubmission<ApiData>> { return mutateSubmitted('DELETE', () => request(`/items/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(validateMutationResult).then(() => getAuthoritativeRemoteData())); }
export async function createWork(input: WorkPayload): Promise<MutationSubmission<ApiData>> { return mutateSubmitted('POST', () => request('/works', { method: 'POST', body: JSON.stringify({ work: input }) }).then(validateMutationResult).then(() => getAuthoritativeRemoteData())); }
export async function updateWork(id: string, input: Omit<WorkPayload, 'id'>): Promise<MutationSubmission<ApiData>> { return mutateSubmitted('PUT', () => request(`/works/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ work: input }) }).then(validateMutationResult).then(() => getAuthoritativeRemoteData())); }
export async function deleteWork(id: string): Promise<MutationSubmission<ApiData>> { return mutateSubmitted('DELETE', () => request(`/works/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(validateMutationResult).then(() => getAuthoritativeRemoteData())); }
export async function getAsset(path: string): Promise<Blob> { const headers = new Headers({ Accept: 'image/*' }); const token = authToken(); if (token) headers.set('Authorization', `Bearer ${token}`); const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS); try { const response = await fetch(endpoint(`/assets/${path.split('/').map(encodeURIComponent).join('/')}`), { headers, cache: 'no-store', signal: controller.signal }); if (!response.ok) throw dataError(`圖片讀取失敗（${response.status}）。`); return await response.blob(); } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw dataError('圖片請求逾時，請稍後再試。'); throw error; } finally { window.clearTimeout(timer); } }
export async function putAsset(path: string, content: string): Promise<MutationSubmission<AssetResult>> { return mutateSubmitted('PUT', () => request(`/assets/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: JSON.stringify({ path, content }) }).then(validateAssetResult)); }
export async function deleteAsset(path: string): Promise<MutationSubmission<AssetDeleteResult>> { return mutateSubmitted('DELETE', () => request(`/assets/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }).then(validateAssetDeleteResult)); }
export async function getShipping(): Promise<StoreState['shipping']> { const data = await request('/shipping'); if (!Array.isArray(data) || !data.every(validateShipping)) throw dataError('API 回傳運費資料格式無效。'); return data as StoreState['shipping']; }
export async function putShipping(record: StoreState['shipping'][number]): Promise<MutationSubmission<ApiData>> { return mutateSubmitted('PUT', () => request(`/shipping/${encodeURIComponent(record.id)}`, { method: 'PUT', body: JSON.stringify({ shipping: record }) }).then(validateMutationResult).then(() => getAuthoritativeRemoteData())); }
export async function deleteShipping(id: string): Promise<MutationSubmission<ApiData>> { return mutateSubmitted('DELETE', () => request(`/shipping/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(validateMutationResult).then(() => getAuthoritativeRemoteData())); }
export async function getAuthStatus(): Promise<AuthStatus> { const status = validateAuthStatus(await request('/auth/status')); managementVerified = status.authenticated; return status; }
export function hasChiAuthToken(): boolean { return Boolean(sessionAccessToken); }
export function setChiAuthToken(value: string): void { resetManagementVerification(); sessionAccessToken = value.trim(); }
export function clearChiAuthToken(): void { resetManagementVerification(); sessionAccessToken = ''; try { sessionStorage.removeItem('chi-auth-token'); } catch {} }
export type ChiAuthConfig = { clientId: string; authUrl: string };
export async function getChiAuthConfig(): Promise<ChiAuthConfig> { const value = await request('/auth/config'); if (!isRecord(value) || typeof value.clientId !== 'string' || !value.clientId || typeof value.authUrl !== 'string' || !value.authUrl) throw dataError('Chi Auth 尚未完成設定。'); return { clientId: value.clientId, authUrl: value.authUrl.replace(/\\/$/, '') }; }
export function apiConfigured(): boolean { return Boolean(API_BASE); }
