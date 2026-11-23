import './sync-overlay.css';

type FeedbackKind = 'info' | 'success' | 'error';

let active = 0;
let overlay: HTMLElement | null = null;
let feedbackTimer: number | null = null;

function ensureOverlay(): HTMLElement {
  if (overlay?.isConnected) return overlay;
  const element = document.createElement('div');
  element.className = 'sync-overlay';
  element.setAttribute('aria-hidden', 'true');
  element.innerHTML = '<div class="sync-overlay-card" role="status" aria-live="polite"><div class="sync-overlay-spinner" aria-hidden="true"><i></i><i></i><i></i></div><strong class="sync-overlay-title">正在同步</strong><span class="sync-overlay-label"></span><small>請稍候，資料傳送中</small></div>';
  document.body.appendChild(element);
  overlay = element;
  return element;
}

function setVisible(visible: boolean, label = '正在同步資料…'): void {
  const element = ensureOverlay();
  const labelNode = element.querySelector<HTMLElement>('.sync-overlay-label');
  const titleNode = element.querySelector<HTMLElement>('.sync-overlay-title');
  const smallNode = element.querySelector<HTMLElement>('.sync-overlay-card small');
  const spinner = element.querySelector<HTMLElement>('.sync-overlay-spinner');
  if (titleNode) titleNode.textContent = '正在同步';
  if (labelNode) labelNode.textContent = label;
  if (smallNode) smallNode.textContent = '請稍候，資料傳送中';
  spinner?.classList.remove('is-feedback');
  element.classList.remove('is-feedback', 'feedback-info', 'feedback-success', 'feedback-error');
  element.classList.toggle('is-visible', visible);
  element.setAttribute('aria-hidden', String(!visible));
  document.documentElement.classList.toggle('is-syncing', visible);
  document.body.classList.toggle('is-syncing', visible);
}

function start(label: string): void {
  if (feedbackTimer !== null) {
    window.clearTimeout(feedbackTimer);
    feedbackTimer = null;
  }
  active += 1;
  setVisible(true, label);
}

function end(): void {
  active = Math.max(0, active - 1);
  if (active === 0) setVisible(false);
}

export async function runWithSync<T>(label: string, operation: () => Promise<T>): Promise<T> {
  start(label);
  try {
    return await operation();
  } finally {
    end();
  }
}

export function showFeedback(message: string, kind: FeedbackKind = 'info', duration = 2200): void {
  const element = ensureOverlay();
  const titleNode = element.querySelector<HTMLElement>('.sync-overlay-title');
  const labelNode = element.querySelector<HTMLElement>('.sync-overlay-label');
  const smallNode = element.querySelector<HTMLElement>('.sync-overlay-card small');
  const spinner = element.querySelector<HTMLElement>('.sync-overlay-spinner');
  if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
  if (titleNode) titleNode.textContent = kind === 'success' ? '完成' : kind === 'error' ? '操作失敗' : '提示';
  if (labelNode) labelNode.textContent = message;
  if (smallNode) smallNode.textContent = '';
  spinner?.classList.add('is-feedback');
  element.classList.add('is-feedback', `feedback-${kind}`, 'is-visible');
  element.setAttribute('aria-hidden', 'false');
  feedbackTimer = window.setTimeout(() => {
    element.classList.remove('is-visible', 'is-feedback', 'feedback-info', 'feedback-success', 'feedback-error');
    spinner?.classList.remove('is-feedback');
    element.setAttribute('aria-hidden', 'true');
    feedbackTimer = null;
  }, Math.max(900, duration));
}
