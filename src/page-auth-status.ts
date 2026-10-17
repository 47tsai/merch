import './page-auth-status.css';
import { getAuthStatus, hasChiAuthToken } from './api';

const TARGET_PAGES = new Set(['add', 'management', 'shipping']);
let verificationRequest = 0;

function statusFor(page: HTMLElement): HTMLElement {
  let status = page.querySelector<HTMLElement>('[data-page-auth-status]');
  if (status) return status;
  const heading = page.querySelector<HTMLElement>('.page-heading');
  if (!heading) throw new Error('Page heading not found');
  status = document.createElement('span');
  status.className = 'page-auth-status';
  status.dataset.pageAuthStatus = '';
  status.dataset.authenticated = 'false';
  status.textContent = '未驗證';
  const wrap = document.createElement('div');
  wrap.className = 'page-auth-status-wrap';
  wrap.appendChild(status);
  heading.appendChild(wrap);
  return status;
}

function setStatus(status: HTMLElement, authenticated: boolean): void {
  status.textContent = authenticated ? '已驗證' : '未驗證';
  status.dataset.authenticated = String(authenticated);
}

async function refresh(): Promise<void> {
  const requestId = ++verificationRequest;
  const pages = [...document.querySelectorAll<HTMLElement>('[data-page]')]
    .filter((page) => TARGET_PAGES.has(page.dataset.page || ''));
  if (!pages.length) return;
  const statuses = pages.map((page) => statusFor(page));
  if (!hasChiAuthToken()) {
    statuses.forEach((status) => setStatus(status, false));
    return;
  }
  try {
    const result = await getAuthStatus();
    if (requestId !== verificationRequest) return;
    statuses.forEach((status) => setStatus(status, result.authenticated));
  } catch {
    if (requestId !== verificationRequest) return;
    statuses.forEach((status) => setStatus(status, false));
  }
}

function bind(): void {
  void refresh();
  window.addEventListener('hashchange', () => void refresh());
  window.addEventListener('merch-auth-status-changed', () => void refresh());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
else bind();
