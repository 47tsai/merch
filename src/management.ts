import './management.css';
import './management-images.css';
import { getAsset, putAsset, deleteAsset, getAuthoritativeRemoteData } from './api';
import { resolveAssetUrl } from './image-source';
import { getStore, type MerchStore } from './store';
import type { ImageMeta, Item } from './types';
import { qs } from './utils/dom';
import { showToast } from './utils/toast';
import { ensureFormErrors, setFormErrors, clearFormErrors } from './utils/form-feedback';
import { categoryName } from './category-label';

let storeRef: MerchStore | null = null;
let selectedId = '';
let pickerWork = '';
let pickerCategory = '';
let pickerSerial = '';
let searchQuery = '';
let saving = false;
let imageSaving = false;
let mountedRoot: HTMLElement | null = null;
let mountController: AbortController | null = null;

const allowedImageTypes = new Map([['image/jpeg', new Set(['jpg', 'jpeg'])], ['image/png', new Set(['png'])], ['image/webp', new Set(['webp'])], ['image/gif', new Set(['gif'])], ['image/avif', new Set(['avif'])]]);
const allItems = (): Item[] => storeRef?.snapshot.items ?? [];
const selectedItem = (): Item | undefined => allItems().find(item => item.id === selectedId);
const workOf = (item: Item): string => item.workId;
const serialOf = (item: Item): string => item.id.match(/(\d+)$/)?.[1] ?? '';
const value = (id: string): string => (qs<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`)?.value ?? '').trim();
const setValue = (id: string, next: string): void => { const el = qs<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`); if (el) el.value = next; };
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));

function setOptions(select: HTMLSelectElement | null, options: Array<{ value: string; label: string }>, selected = ''): void { if (!select) return; const fragment = document.createDocumentFragment(); for (const option of options) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; fragment.appendChild(node); } select.replaceChildren(fragment); if (selected && options.some(option => option.value === selected)) select.value = selected; else if (options[0]) select.value = options[0].value; }
function fill(item: Item): void {
  selectedId = item.id; pickerWork = item.workId; pickerCategory = item.category; pickerSerial = serialOf(item);
  setValue('management-item-id', item.id); setValue('management-title', item.title); setValue('management-series', item.series.join(', ')); setValue('management-characters', item.characters.join(', ')); setValue('management-manufacturer', item.manufacturer); setValue('management-quantity', String(item.quantity)); setValue('management-status', item.status); setValue('management-description', item.description); setValue('management-notes', item.notes); setValue('management-price', item.purchase?.price == null ? '' : String(item.purchase.price)); setValue('management-currency', item.purchase?.currency ?? 'TWD'); setValue('management-platform', item.purchase?.platform ?? ''); setValue('management-purchase-date', item.purchase?.date ?? ''); setValue('management-expected-date', item.arrival?.expectedDate ?? ''); setValue('management-received-date', item.arrival?.receivedDate ?? ''); setValue('management-after-sales-status', item.afterSales?.status ?? ''); setValue('management-after-sales-note', item.afterSales?.note ?? '');
}
function readFormItem(base: Item): Item {
  const series = value('management-series').split(',').map(item => item.trim()).filter(Boolean); const characters = value('management-characters').split(',').map(item => item.trim()).filter(Boolean); const priceText = value('management-price');
  return { ...base, title: value('management-title'), series, characters, manufacturer: value('management-manufacturer'), quantity: Number(value('management-quantity')), status: value('management-status') || 'pending', description: value('management-description'), notes: value('management-notes'), category: value('management-picker-category') || base.category, purchase: { ...(base.purchase ?? {}), ...(priceText ? { price: Number(priceText) } : { price: undefined }), currency: value('management-currency') || undefined, platform: value('management-platform') || undefined, date: value('management-purchase-date') || undefined }, arrival: { ...(base.arrival ?? {}), expectedDate: value('management-expected-date') || undefined, receivedDate: value('management-received-date') || undefined }, afterSales: { ...(base.afterSales ?? {}), status: value('management-after-sales-status') || undefined, note: value('management-after-sales-note') || undefined } };
}
function validateItem(item: Item): string[] { const errors: string[] = []; if (!item.title.trim()) errors.push('標題為必填欄位。'); if (!Number.isInteger(item.quantity) || item.quantity < 1) errors.push('數量必須是大於等於 1 的整數。'); if (item.purchase?.price !== undefined && (!Number.isFinite(item.purchase.price) || item.purchase.price < 0)) errors.push('價格必須是大於等於 0 的數字。'); if (!item.category.trim()) errors.push('類型為必填欄位。'); return errors; }
function imageList(item: Item): ImageMeta[] { return Array.isArray(item.images) ? item.images.map(image => ({ ...image })) : []; }
function normalizeCover(images: ImageMeta[]): ImageMeta[] {
  if (!images.length) return [];
  const coverIndex = images.findIndex(image => image.isCover === true);
  return images.map((image, index) => ({ ...image, ...(index === (coverIndex >= 0 ? coverIndex : 0) ? { isCover: true } : { isCover: undefined }) }));
}
function imageFileName(item: Item, extension: string, index: number): string { const base = item.id; return `${base}${index === 0 ? '' : `-${index + 1}`}.${extension}`; }
function imagePath(item: Item, file: File, index: number): string { const ext = file.name.split('.').pop()?.toLowerCase() ?? ''; return `data/${item.workId}/${item.category}/${item.id}/images/${imageFileName(item, ext, index)}`; }
async function fileToBase64(file: File): Promise<string> { return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('圖片讀取失敗。')); reader.onload = () => { const text = String(reader.result ?? ''); const comma = text.indexOf(','); if (comma < 0) reject(new Error('圖片資料格式無效。')); else resolve(text.slice(comma + 1)); }; reader.readAsDataURL(file); }); }
async function blobToBase64(blob: Blob): Promise<string> { const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }
async function optimizeImage(file: File): Promise<File> { if (file.type !== 'image/jpeg') return file; const url = URL.createObjectURL(file); try { const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error('圖片讀取失敗。')); element.src = url; }); const maxDimension = 2400; const needsResize = Math.max(image.naturalWidth, image.naturalHeight) > maxDimension; if (!needsResize && file.size <= 1024 * 1024) return file; const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight)); const width = Math.max(1, Math.round(image.naturalWidth * scale)); const height = Math.max(1, Math.round(image.naturalHeight * scale)); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); if (!context) throw new Error('圖片壓縮功能無法初始化。'); context.drawImage(image, 0, 0, width, height); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('圖片壓縮失敗。')), 'image/jpeg', 0.85)); return new File([blob], file.name.replace(/\.(?:jpe?g)$/i, '.jpg'), { type: 'image/jpeg', lastModified: file.lastModified }); } finally { URL.revokeObjectURL(url); } }
function imageMeta(item: Item, path: string, alt?: string, id?: string, isCover = false): ImageMeta { const file = path.split('/').pop() || path; return { id: id ?? `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file, ...(alt ? { alt } : {}), ...(isCover ? { isCover: true } : {}) }; }
async function saveImages(item: Item, images: ImageMeta[]): Promise<void> { if (!storeRef) throw new Error('資料庫尚未載入。'); await storeRef.updateItem({ ...item, images: normalizeCover(images) }); }
function validImageFile(file: File): boolean { const extension = file.name.split('.').pop()?.toLowerCase() ?? ''; const extensions = allowedImageTypes.get(file.type); return Boolean(extensions?.has(extension) && file.size <= 8 * 1024 * 1024); }
async function uploadImage(file: File): Promise<void> {
  const item = selectedItem();
  if (!item) return showToast('請先選擇收藏，再上傳圖片。', 'error');
  if (saving || imageSaving) return showToast('目前正在同步資料，請稍後再操作圖片。', 'info');
  if (!validImageFile(file)) return showToast('只允許 JPG/JPEG、PNG、WebP、GIF、AVIF，且不超過 8 MB。', 'error');
  imageSaving = true; render(); showToast('圖片上傳同步中，請稍候。', 'info');
  try {
    const optimizedFile = await optimizeImage(file);
    const path = imagePath(item, optimizedFile, imageList(item).length);
    const submission = await putAsset(path, await fileToBase64(optimizedFile));
    showToast('圖片已送出，背景同步中。', 'success');
    void submission.settled.then(async () => { const data = await getAuthoritativeRemoteData(); storeRef?.replaceData(data.works, data.version, data.shipping); }).catch(() => {});
  } catch (error) { showToast(error instanceof Error ? error.message : '圖片上傳失敗。', 'error'); }
  finally { imageSaving = false; render(); }
}
async function replaceImage(file: File, imageId: string): Promise<void> {
  const item = selectedItem(); const images = item ? imageList(item) : []; const index = images.findIndex(image => image.id === imageId); const current = index >= 0 ? images[index] : undefined;
  if (!item || !current) return;
  if (saving || imageSaving) return showToast('目前正在同步資料，請稍後再操作圖片。', 'info');
  if (!validImageFile(file)) return showToast('只允許 JPG/JPEG、PNG、WebP、GIF、AVIF，且不超過 8 MB。', 'error');
  imageSaving = true; render(); showToast('圖片替換同步中，請稍候。', 'info');
  const currentPath = `data/${item.workId}/${item.category}/${item.id}/images/${current.file}`;
  try {
    const optimizedFile = await optimizeImage(file);
    const path = imagePath(item, optimizedFile, index);
    const submission = await putAsset(path, await fileToBase64(optimizedFile));
    if (path !== currentPath) {
      void (async () => {
        try {
          const cleanup = await deleteAsset(currentPath);
          await cleanup.settled;
          const data = await getAuthoritativeRemoteData();
          storeRef?.replaceData(data.works, data.version, data.shipping);
        } catch {
          try {
            const data = await getAuthoritativeRemoteData();
            storeRef?.replaceData(data.works, data.version, data.shipping);
          } catch {}
          showToast('新圖片已送出，舊圖片清理將在背景繼續。', 'info');
        }
      })();
    } else {
      void submission.settled.then(async () => { const data = await getAuthoritativeRemoteData(); storeRef?.replaceData(data.works, data.version, data.shipping); }).catch(() => {});
    }
    showToast('圖片替換已送出，背景同步中。', 'success');
  } catch (error) { showToast(error instanceof Error ? error.message : '圖片替換失敗。', 'error'); }
  finally { imageSaving = false; render(); }
}
async function deleteImage(imageId: string): Promise<void> {
  const item = selectedItem(); const image = item ? imageList(item).find(entry => entry.id === imageId) : undefined;
  if (!item || !image || saving || imageSaving || !window.confirm(`確定要刪除「${image.file}」？`)) return;
  imageSaving = true; render(); showToast('圖片刪除同步中，請稍候。', 'info');
  try {
    const submission = await deleteAsset(`data/${item.workId}/${item.category}/${item.id}/images/${image.file}`);
    showToast('圖片刪除已送出，背景同步中。', 'success');
    void submission.settled.then(async () => { const data = await getAuthoritativeRemoteData(); storeRef?.replaceData(data.works, data.version, data.shipping); }).catch(() => {});
  } catch (error) { showToast(error instanceof Error ? error.message : '圖片刪除失敗。', 'error'); }
  finally { imageSaving = false; render(); }
}
async function setCover(imageId: string): Promise<void> {
  const item = selectedItem(); if (!item || saving || imageSaving) return;
  const images = imageList(item); if (!images.some(image => image.id === imageId)) return;
  imageSaving = true; render(); showToast('主圖設定同步中，請稍候。', 'info');
  try { await saveImages(item, images.map(image => ({ ...image, ...(image.id === imageId ? { isCover: true } : { isCover: undefined }) }))); showToast('已設為主圖。', 'success'); }
  catch (error) { showToast(error instanceof Error ? error.message : '主圖設定失敗。', 'error'); }
  finally { imageSaving = false; render(); }
}
async function moveImage(imageId: string, direction: -1 | 1): Promise<void> {
  const item = selectedItem(); if (!item || saving || imageSaving) return;
  const images = imageList(item); const index = images.findIndex(image => image.id === imageId); const target = index + direction;
  if (index < 0 || target < 0 || target >= images.length) return;
  [images[index], images[target]] = [images[target], images[index]];
  imageSaving = true; render(); showToast('圖片排序同步中，請稍候。', 'info');
  try { await saveImages(item, images); showToast('圖片順序已更新。', 'success'); }
  catch (error) { showToast(error instanceof Error ? error.message : '圖片排序失敗。', 'error'); }
  finally { imageSaving = false; render(); }
}
function renderImageArea(item: Item | undefined): void {
  const root = qs<HTMLElement>('[data-management-images]'); if (!root) return; root.replaceChildren();
  if (!item) { root.textContent = '請先選擇收藏，再管理圖片。'; return; }
  const images = imageList(item);
  if (!images.length) { const notice = document.createElement('div'); notice.className = 'notice'; notice.textContent = '目前沒有圖片。可從上方上傳圖片。'; root.appendChild(notice); return; }
  images.forEach((image, index) => {
    const row = document.createElement('div'); row.className = 'management-image-row'; row.dataset.imageId = image.id;
    const preview = document.createElement('div'); preview.className = 'management-image-preview';
    const url = resolveAssetUrl(`data/${item.workId}/${item.category}/${item.id}/images/${image.file}`);
    if (url) { const img = document.createElement('img'); img.src = url; img.alt = image.alt || item.title; img.loading = 'lazy'; preview.appendChild(img); } else preview.textContent = '無預覽';
    const info = document.createElement('div'); info.className = 'management-image-info';
    const strong = document.createElement('strong'); strong.textContent = image.isCover ? '主圖' : `圖片 ${index + 1}`;
    const small = document.createElement('small'); small.textContent = image.file; info.append(strong, small);
    const actions = document.createElement('div'); actions.className = 'management-image-actions';
    const cover = document.createElement('button'); cover.className = 'button secondary'; cover.type = 'button'; cover.textContent = image.isCover ? '目前主圖' : '設為主圖'; cover.disabled = imageSaving || Boolean(image.isCover);
    const up = document.createElement('button'); up.className = 'button secondary'; up.type = 'button'; up.textContent = '↑'; up.title = '上移'; up.setAttribute('aria-label', `將圖片 ${index + 1} 上移`); up.disabled = imageSaving || index === 0;
    const down = document.createElement('button'); down.className = 'button secondary'; down.type = 'button'; down.textContent = '↓'; down.title = '下移'; down.setAttribute('aria-label', `將圖片 ${index + 1} 下移`); down.disabled = imageSaving || index === images.length - 1;
    const replaceLabel = document.createElement('label'); replaceLabel.className = 'button secondary management-image-replace'; replaceLabel.appendChild(document.createTextNode('替換')); const replace = document.createElement('input'); replace.type = 'file'; replace.accept = '.jpg,.jpeg,.png,.webp,.gif,.avif,image/jpeg,image/png,image/webp,image/gif,image/avif'; replace.hidden = true; replace.disabled = imageSaving; replaceLabel.appendChild(replace);
    const remove = document.createElement('button'); remove.className = 'button danger'; remove.type = 'button'; remove.textContent = '刪除'; remove.disabled = imageSaving;
    actions.append(cover, up, down, replaceLabel, remove); row.append(preview, info, actions); root.appendChild(row);
  });
}
function render(): void {
  if (!storeRef) return; const works = storeRef.snapshot.works; const items = allItems(); if (!pickerWork || !works.some(work => work.id === pickerWork)) pickerWork = works[0]?.id ?? '';
  const workSelect = qs<HTMLSelectElement>('#management-picker-work'); setOptions(workSelect, works.map(work => ({ value: work.id, label: work.name })), pickerWork); pickerWork = workSelect?.value ?? pickerWork;
  const availableCategoryCodes = unique(items.filter(item => workOf(item) === pickerWork).map(item => item.category)); if (!availableCategoryCodes.includes(pickerCategory)) pickerCategory = availableCategoryCodes[0] ?? '';
  const categorySelect = qs<HTMLSelectElement>('#management-picker-category'); setOptions(categorySelect, availableCategoryCodes.map(code => ({ value: code, label: categoryName(code) })), pickerCategory); pickerCategory = categorySelect?.value ?? pickerCategory;
  const serialItems = items.filter(item => workOf(item) === pickerWork && item.category === pickerCategory); if (!pickerSerial || !serialItems.some(item => serialOf(item) === pickerSerial)) pickerSerial = serialOf(serialItems[0]) || ''; const serialSelect = qs<HTMLSelectElement>('#management-picker-serial'); setOptions(serialSelect, serialItems.map(item => ({ value: serialOf(item), label: `${serialOf(item).padStart(3, '0')} · ${item.title}` })), pickerSerial); pickerSerial = serialSelect?.value ?? pickerSerial;
  const target = serialItems.find(item => serialOf(item) === pickerSerial) ?? items.find(item => item.id === selectedId) ?? items[0]; if (target && target.id !== selectedId) fill(target); const title = qs<HTMLElement>('#management-form-title'); if (title) title.textContent = '編輯收藏'; const submit = qs<HTMLButtonElement>('#management-submit'); if (submit) { submit.textContent = '儲存修改'; submit.disabled = saving || imageSaving; } const cancel = qs<HTMLButtonElement>('#management-cancel'); if (cancel) { cancel.hidden = true; cancel.disabled = true; } const del = qs<HTMLButtonElement>('#management-delete'); if (del) del.disabled = saving || imageSaving || !selectedItem(); const form = qs<HTMLFormElement>('#management-form'); if (form) { form.classList.remove('is-creating'); form.classList.add('is-editing'); form.setAttribute('aria-busy', String(saving || imageSaving)); } form?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('input,textarea,select,button').forEach(el => { if (el.id !== 'management-cancel' && el.id !== 'management-new') el.disabled = saving || imageSaving; }); renderImageArea(selectedItem()); const count = qs<HTMLElement>('#management-search-count'); if (count) count.textContent = searchQuery ? `搜尋「${searchQuery}」` : `共 ${items.length} 筆收藏`; const datalist = qs<HTMLDataListElement>('#management-search-options'); if (datalist) { datalist.replaceChildren(...items.filter(item => `${item.id} ${item.title} ${item.workName ?? ''}`.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase())).slice(0, 30).map(item => { const option = document.createElement('option'); option.value = `${item.id} · ${item.title}`; return option; })); }
}
async function handleSubmit(event: SubmitEvent): Promise<void> { event.preventDefault(); if (!storeRef || saving || imageSaving) return; const form = qs<HTMLFormElement>('#management-form'); const feedback = ensureFormErrors(form); clearFormErrors(feedback); const base = selectedItem(); if (!base) { const errors = ['找不到要操作的收藏。']; setFormErrors(feedback, errors); showToast(errors[0], 'error'); return; } const item = readFormItem(base); const errors = validateItem(item); if (errors.length) { setFormErrors(feedback, errors); showToast('請先修正表單中的錯誤。', 'error'); return; } saving = true; render(); try { await storeRef.updateItem(item); selectedId = item.id; clearFormErrors(feedback); showToast('收藏更新已送出，背景同步中。', 'success'); } catch (error) { const message = error instanceof Error ? error.message : '儲存失敗。'; setFormErrors(feedback, [message]); showToast(message, 'error'); } finally { saving = false; render(); } }
async function handleDelete(): Promise<void> { const item = selectedItem(); if (!storeRef || !item || saving || imageSaving) return; if (!window.confirm(`確定要刪除「${item.title}」？\n此操作會刪除收藏資料，且 Item ID 不會重新編號。`)) return; saving = true; render(); showToast('收藏刪除同步中，請稍候。', 'info'); try { await storeRef.deleteItem(item.id); selectedId = ''; pickerSerial = ''; showToast('收藏刪除已送出，背景同步中。', 'success'); } catch (error) { showToast(error instanceof Error ? error.message : '刪除失敗。', 'error'); } finally { saving = false; render(); } }
function mount(root: HTMLElement): void {
  if (mountedRoot === root) return;
  mountController?.abort();
  const controller = new AbortController();
  mountedRoot = root;
  mountController = controller;
  const { signal } = controller;
  root.addEventListener('submit', event => { if (event.target instanceof HTMLFormElement && event.target.id === 'management-form') void handleSubmit(event as SubmitEvent); }, { signal });
  root.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    if (target.closest('#management-delete')) return void handleDelete();
    if (target.closest('#management-new')) return void (window.location.hash = '#/add');
    const row = target.closest<HTMLElement>('.management-image-row');
    if (!row) return;
    const imageId = row.dataset.imageId;
    if (!imageId) return;
    if (target.closest('.management-image-actions button:nth-child(1)')) return void setCover(imageId);
    if (target.closest('.management-image-actions button:nth-child(2)')) return void moveImage(imageId, -1);
    if (target.closest('.management-image-actions button:nth-child(3)')) return void moveImage(imageId, 1);
    if (target.closest('.management-image-actions button:last-child')) return void deleteImage(imageId);
  }, { signal });
  root.addEventListener('change', event => {
    if (!(event.target instanceof HTMLElement)) return;
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.id === 'management-picker-work') { pickerWork = target.value; pickerCategory = ''; pickerSerial = ''; selectedId = ''; return render(); }
    if (target instanceof HTMLSelectElement && target.id === 'management-picker-category') { pickerCategory = target.value; pickerSerial = ''; selectedId = ''; return render(); }
    if (target instanceof HTMLSelectElement && target.id === 'management-picker-serial') { pickerSerial = target.value; const item = allItems().find(entry => serialOf(entry) === pickerSerial && workOf(entry) === pickerWork && entry.category === pickerCategory); if (item) fill(item); return render(); }
    if (target instanceof HTMLInputElement && target.id === 'management-image-upload') { const file = target.files?.[0]; if (file) void uploadImage(file); target.value = ''; return; }
    if (target instanceof HTMLInputElement && target.type === 'file' && target.closest('.management-image-replace')) { const row = target.closest<HTMLElement>('.management-image-row'); const imageId = row?.dataset.imageId; const file = target.files?.[0]; if (imageId && file) void replaceImage(file, imageId); target.value = ''; }
  }, { signal });
  root.addEventListener('input', event => {
    if (!(event.target instanceof HTMLInputElement) || event.target.id !== 'management-search') return;
    searchQuery = event.target.value.trim();
    const first = allItems().find(item => `${item.id} · ${item.title}` === searchQuery);
    if (first) fill(first);
    render();
  }, { signal });
  window.addEventListener('merch-management-select', event => {
    if (!storeRef) return;
    const id = (event as CustomEvent<string>).detail;
    if (typeof id !== 'string') return;
    const item = allItems().find(entry => entry.id === id);
    if (!item) return;
    searchQuery = `${item.id} · ${item.title}`;
    fill(item);
    sessionStorage.removeItem('merch-management-selected-id');
    render();
  }, { signal });
}
async function init(): Promise<void> {
  storeRef = await getStore();
  const pendingId = sessionStorage.getItem('merch-management-selected-id') || '';
  if (pendingId) sessionStorage.removeItem('merch-management-selected-id');
  const pendingItem = pendingId ? allItems().find(item => item.id === pendingId) : undefined;
  if (pendingItem) { searchQuery = `${pendingItem.id} · ${pendingItem.title}`; fill(pendingItem); }
  storeRef.subscribe(() => { if (!saving && !imageSaving) render(); });
  const root = qs<HTMLElement>('#management-root');
  if (root) mount(root);
  const first = pendingItem ?? allItems()[0];
  if (first) fill(first);
  render();
}
void init();
