import type { Item, ShippingRecord } from './types';
import { escapeHtml } from './utils/dom';
import './shipping.css';

export function openShippingDetail(record: ShippingRecord, items: Item[]): void {
  const relatedItems = items.filter((item) => record.itemIds.includes(item.id));
  const modal = document.createElement('div');
  modal.className = 'shipping-detail';
  modal.innerHTML = `<div class="shipping-detail-backdrop" data-shipping-close></div><section class="shipping-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="shipping-detail-title" tabindex="-1"><header class="panel-heading"><div><span class="panel-label">SHIPPING DETAIL</span><h2 id="shipping-detail-title">運費詳情</h2></div><button type="button" class="button secondary" data-shipping-close>關閉</button></header><div class="shipping-detail-grid"><div><span>金額</span><strong>${escapeHtml(`${record.currency || 'TWD'} ${new Intl.NumberFormat('zh-TW').format(record.amount)}`)}</strong></div><div><span>日期</span><strong>${escapeHtml(record.date || '未填日期')}</strong></div><div><span>物流／平台</span><strong>${escapeHtml(record.carrier || '未設定')}</strong></div><div><span>關聯周邊</span><strong>${record.itemIds.length} 件</strong></div></div>${record.note ? `<div class="shipping-detail-note"><span>備註</span><p>${escapeHtml(record.note)}</p></div>` : ''}<div class="shipping-detail-items"><h3>關聯周邊</h3>${relatedItems.length ? `<ul>${relatedItems.map((item) => `<li><strong>${escapeHtml(item.id)}</strong><span>${escapeHtml(item.title)}</span></li>`).join('')}</ul>` : '<div class="chi-state"><span class="chi-state__title">關聯的周邊目前不存在。</span></div>'}</div></section>`;
  document.body.appendChild(modal);
  document.body.classList.add('shipping-detail-open');
  const close = () => {
    modal.remove();
    document.body.classList.remove('shipping-detail-open');
  };
  modal.querySelectorAll<HTMLElement>('[data-shipping-close]').forEach((node) => node.addEventListener('click', close));
  modal.querySelector<HTMLElement>('.shipping-detail-dialog')?.focus();
}
