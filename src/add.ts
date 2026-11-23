import './add.css';
import { buildNextItemId } from './item-id';
import { getStore } from './store';
import { CATEGORY_OPTIONS } from './category-label';
import { showToast } from './utils/toast';
import { ensureFormErrors, setFormErrors, clearFormErrors } from './utils/form-feedback';
import type { Item } from './types';

const qs = <T extends Element>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector);
const value = (id: string) => (qs<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`)?.value ?? '').trim();
let submitting = false;
let mountedPage: HTMLElement | null = null;
let mountController: AbortController | null = null;

function setBusy(busy: boolean): void {
  submitting = busy;
  const form = qs<HTMLFormElement>('#add-form');
  if (!form) return;
  form.setAttribute('aria-busy', String(busy));
  form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('input,textarea,select,button').forEach(control => { control.disabled = busy; });
  const button = qs<HTMLButtonElement>('#add-form button[type="submit"]');
  if (button) button.textContent = busy ? '儲存中…' : '＋ 新增收藏';
}

function populateCategoryOptions(): void {
  const select = qs<HTMLSelectElement>('#add-category');
  if (!select) return;
  const current = select.value;
  select.replaceChildren(...CATEGORY_OPTIONS.map(([code, name]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    return option;
  }));
  if (CATEGORY_OPTIONS.some(([code]) => code === current)) select.value = current;
}

function populateWorkOptions(): void {
  const select = qs<HTMLSelectElement>('#add-work');
  if (!select) return;
  void getStore().then(store => {
    const current = select.value;
    select.replaceChildren(...store.snapshot.works.map(work => { const option = document.createElement('option'); option.value = work.id; option.textContent = `${work.name} (${work.code})`; return option; }));
    if (current && store.snapshot.works.some(work => work.id === current)) select.value = current;
    if (!store.snapshot.works.length) showToast('目前沒有可用的作品，請先建立作品。', 'error');
  }).catch(error => showToast(error instanceof Error ? error.message : '新增頁載入失敗。', 'error'));
}

function clearForm(): void {
  const form = qs<HTMLFormElement>('#add-form');
  if (!form) return;
  form.reset();
  clearFormErrors(ensureFormErrors(form));
  const quantity = qs<HTMLInputElement>('#add-quantity');
  const currency = qs<HTMLInputElement>('#add-currency');
  const status = qs<HTMLSelectElement>('#add-status');
  if (quantity) quantity.value = '1';
  if (currency) currency.value = 'TWD';
  if (status) status.value = 'received';
}

async function submit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (submitting) return;
  const form = qs<HTMLFormElement>('#add-form');
  const feedback = ensureFormErrors(form);
  clearFormErrors(feedback);
  const store = await getStore();
  const work = store.snapshot.works.find(item => item.id === value('add-work')) ?? store.snapshot.works[0];
  if (!work) { const errors = ['目前沒有可用的作品，請先建立作品。']; setFormErrors(feedback, errors); showToast(errors[0], 'error'); return; }
  const title = value('add-title');
  const quantity = Number(value('add-quantity'));
  const priceText = value('add-price');
  const category = value('add-category');
  const errors: string[] = [];
  if (!title) errors.push('標題為必填欄位。');
  if (!Number.isInteger(quantity) || quantity < 1) errors.push('數量必須是大於等於 1 的整數。');
  if (priceText && (!Number.isFinite(Number(priceText)) || Number(priceText) < 0)) errors.push('價格必須是大於等於 0 的數字。');
  if (!category) errors.push('類型為必填欄位。');
  if (errors.length) { setFormErrors(feedback, errors); showToast('請先修正表單中的錯誤。', 'error'); return; }
  const item: Item = {
    id: buildNextItemId(store.snapshot.items.map(x => x.id), work.code, category), workId: work.id, title,
    series: value('add-series').split(',').map(x => x.trim()).filter(Boolean), characters: value('add-characters').split(',').map(x => x.trim()).filter(Boolean),
    category, manufacturer: value('add-manufacturer'), quantity, status: value('add-status') as Item['status'], description: value('add-description'), notes: value('add-notes'),
    purchase: { price: priceText ? Number(priceText) : undefined, currency: value('add-currency') || undefined, platform: value('add-platform') || undefined, date: value('add-purchase-date') || undefined },
    arrival: { expectedDate: value('add-expected-date') || undefined, receivedDate: value('add-received-date') || undefined }, afterSales: {}, images: [],
  };
  setBusy(true);
  try {
    const warning = await store.addItem(item);
    clearFormErrors(feedback);
    sessionStorage.setItem('merch-management-selected-id', item.id);
    showToast(warning ?? '收藏已新增。', warning ? 'info' : 'success');
    const result = qs<HTMLElement>('#add-result'); const resultText = qs<HTMLElement>('#add-result-item');
    if (resultText) resultText.textContent = `${item.id} · ${item.title}`;
    if (result) result.hidden = false;
    qs<HTMLButtonElement>('#add-result-management')?.focus();
  } catch (error) {
    const message = error instanceof Error ? error.message : '新增收藏失敗。';
    setFormErrors(feedback, [message]); showToast(message, 'error');
  } finally { setBusy(false); }
}

function closeResult(): void { const result = qs<HTMLElement>('#add-result'); if (result) result.hidden = true; }

function mount(page: HTMLElement): void {
  if (mountedPage === page) return;
  mountController?.abort();
  const controller = new AbortController();
  mountedPage = page;
  mountController = controller;
  const form = qs<HTMLFormElement>('#add-form', page);
  if (form) { form.noValidate = true; ensureFormErrors(form); }
  page.addEventListener('submit', event => {
    if ((event.target as Element | null)?.closest('#add-form')) void submit(event as SubmitEvent);
  }, { signal: controller.signal });
  page.addEventListener('click', event => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('#add-result-close, #add-result-backdrop, #add-result-management, #add-result-cancel');
    if (!target) return;
    if (target.id === 'add-result-management') { closeResult(); location.hash = '#/management'; return; }
    closeResult();
  }, { signal: controller.signal });
}

function render(): void {
  const page = qs<HTMLElement>('[data-page="add"]'); if (!page) return;
  mount(page);
  page.hidden = location.hash !== '#/add' && location.hash !== '#add'; if (page.hidden) return;
  populateCategoryOptions();
  const status = qs<HTMLSelectElement>('#add-status'); if (status) status.value = 'received'; populateWorkOptions();
}

render(); window.addEventListener('hashchange', render);
