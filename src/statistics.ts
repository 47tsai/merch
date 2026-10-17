import './statistics.css';
import { getStore, type MerchStore } from './store';
import { aggregateStatistics, statisticsYears, type Chart, type WorkItemDetail } from './statistics-data';
import { currentYear } from './utils/date';
import { escapeHtml, qs, qsa } from './utils/dom';
import { formatMoney, formatPercent, formatQuantity } from './utils/format';

const chartColors = ['#5B4BC4','#8879E8','#A99FFF','#4636A5','#6B5BD1','#C9C2FF'];
let selectedYear = currentYear();

function chartSvg(chart: Chart, large = false): string {
  const type = large ? chart.largeType : chart.smallType;
  const mobile = large && window.matchMedia('(max-width: 700px)').matches;
  const width = mobile ? 680 : large ? 1100 : 920;
  const height = mobile
    ? type === 'donut'
      ? 260
      : chart.id === 'monthly-spending'
        ? 260
        : Math.max(150, 32 + chart.rows.length * 28)
    : large ? 520 : 430;
  if (!chart.rows.length) return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(chart.title)}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">目前沒有足夠資料</text></svg>`;
  if (type === 'donut') return donutSvg(chart, width, height, large, mobile);
  return barSvg(chart, width, height, large, mobile);
}

function verticalMonthlySvg(chart: Chart, width: number, height: number, large: boolean, mobile = false): string {
  const left = mobile ? 48 : large ? 65 : 48;
  const right = mobile ? 18 : large ? 28 : 18;
  const top = mobile ? 30 : 28;
  const bottom = mobile ? 55 : large ? 58 : 52;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const max = Math.max(...chart.rows.map(r => r.value), 1);
  const gap = mobile ? 8 : large ? 12 : 8;
  const slot = plotW / chart.rows.length;
  const barW = Math.max(8, slot - gap);
  const labels = chart.rows.map((r, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    const h = r.value / max * plotH;
    const y = top + plotH - h;
    const value = chart.format === 'money' ? formatMoney(r.value) : formatQuantity(r.value);
    return `<g class="chart-bar-item"><title>${escapeHtml(r.label)}：${escapeHtml(value)}</title><rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="5" class="bar-fill"></rect><text x="${x + barW / 2}" y="${height - bottom + 20}" text-anchor="middle">${escapeHtml(r.label)}</text>${large ? `<text x="${x + barW / 2}" y="${Math.max(18, y - 7)}" text-anchor="middle" class="bar-value">${escapeHtml(value)}</text>` : ''}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(chart.title)}"><line x1="${left}" y1="${top + plotH}" x2="${width - right}" y2="${top + plotH}" class="chart-axis"></line>${labels}</svg>`;
}

function barSvg(chart: Chart, width: number, height: number, large: boolean, mobile = false): string {
  if (chart.id === 'monthly-spending') return verticalMonthlySvg(chart, width, height, large, mobile);
  const left = mobile ? 145 : large ? 230 : 175;
  const right = mobile ? 60 : 95;
  const top = mobile ? 24 : 30;
  const bottom = mobile ? 30 : 42;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const max = Math.max(...chart.rows.map(r => r.value), 0);
  const gap = mobile ? 8 : large ? 12 : 10;
  const rowH = Math.max(mobile ? 24 : 25, (plotH - gap * Math.max(0, chart.rows.length - 1)) / chart.rows.length);
  const barH = Math.min(rowH - 5, mobile ? 22 : large ? 30 : 24);
  const labels = chart.rows.map((r, i) => {
    const y = top + i * (rowH + gap);
    const barW = max ? Math.max(r.value === 0 ? 0 : 2, r.value / max * (plotW - 15)) : 0;
    const text = chart.format === 'money' ? formatMoney(r.value) : formatQuantity(r.value);
    const clickable = chart.id === 'work-spending' && large;
    return `<g class="chart-bar${clickable ? ' chart-bar-clickable' : ''}"${clickable ? ' data-work-bar="' + escapeHtml(r.label) + '" tabindex="0" role="button"' : ''}><text x="${left - 10}" y="${y + barH / 2 + (mobile ? 5 : 4)}" text-anchor="end">${escapeHtml(r.label)}</text><rect x="${left}" y="${y}" width="${plotW}" height="${barH}" rx="9" class="chart-track"/><rect x="${left}" y="${y}" width="${barW}" height="${barH}" rx="9" class="chart-fill"/><text x="${Math.min(width - right, left + barW + 8)}" y="${y + barH / 2 + (mobile ? 5 : 4)}" class="chart-value">${escapeHtml(text)}</text><title>${escapeHtml(r.label)}：${escapeHtml(text)}${clickable ? '，點擊查看作品明細' : ''}</title></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(chart.title)}">${labels}</svg>`;
}

function donutSvg(chart: Chart, width: number, height: number, large: boolean, mobile = false): string {
  const cx = mobile ? 190 : 300;
  const cy = height / 2;
  const radius = mobile ? Math.min(110, Math.max(72, height / 2 - 18)) : large ? 175 : 190;
  const inner = mobile ? Math.max(44, radius * 0.61) : large ? 105 : 112;
  const total = chart.rows.reduce((s, r) => s + r.value, 0) || 1;
  let angle = -Math.PI / 2;
  const arcs = chart.rows.map((r, i) => {
    const start = angle, end = angle + r.value / total * Math.PI * 2;
    angle = end;
    const largeArc = end - start > Math.PI ? 1 : 0;
    const p1 = [cx + radius * Math.cos(start), cy + radius * Math.sin(start)];
    const p2 = [cx + radius * Math.cos(end), cy + radius * Math.sin(end)];
    const q1 = [cx + inner * Math.cos(end), cy + inner * Math.sin(end)];
    const q2 = [cx + inner * Math.cos(start), cy + inner * Math.sin(start)];
    const d = `M ${p1[0]} ${p1[1]} A ${radius} ${radius} 0 ${largeArc} 1 ${p2[0]} ${p2[1]} L ${q1[0]} ${q1[1]} A ${inner} ${inner} 0 ${largeArc} 0 ${q2[0]} ${q2[1]} Z`;
    const color = chartColors[i % chartColors.length];
    return `<path d="${d}" class="donut-segment" fill="${color}" tabindex="0"><title>${escapeHtml(r.label)}：${chart.format === 'money' ? formatMoney(r.value) : formatQuantity(r.value)}（${formatPercent(r.value / total * 100)}）</title></path>`;
  }).join('');
  const legendX = mobile ? 355 : large ? 600 : 610;
  const legendTextX = legendX + 15;
  const legend = chart.rows.map((r, i) => {
    const color = chartColors[i % chartColors.length];
    return `<g class="donut-legend"><circle cx="${legendX}" cy="${35 + i * 30}" r="${mobile ? 7 : 8}" fill="${color}" class="donut-dot"/><text x="${legendTextX}" y="${39 + i * 30}">${escapeHtml(r.label)} · ${chart.format === 'money' ? formatMoney(r.value) : formatQuantity(r.value)} · ${formatPercent(r.value / total * 100)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(chart.title)}">${arcs}<text x="${cx}" y="${cy - 5}" text-anchor="middle" class="donut-total">${total}</text><text x="${cx}" y="${cy + 18}" text-anchor="middle" class="donut-caption">收藏</text>${legend}</svg>`;
}

function detailTable(chart: Chart): string {
  return `<div class="statistics-data"><div class="statistics-data-head"><span>完整資料</span><span>${chart.details.length} 筆</span></div><div class="statistics-data-table"><div class="statistics-data-table-row statistics-data-table-header"><span>項目</span><span>數量</span><span>消費</span><span>占比</span><span>補充</span></div>${chart.details.map(row => `<div class="statistics-data-table-row${chart.id === 'work-spending' ? ' statistics-work-detail-row' : ''}"${chart.id === 'work-spending' ? ' data-work-detail="' + escapeHtml(row.label) + '" tabindex="0" role="button"' : ''}><strong class="statistics-data-item">${escapeHtml(row.label)}</strong><span class="statistics-data-quantity">${escapeHtml(formatQuantity(row.quantity))}</span><span class="statistics-data-spend">${escapeHtml(formatMoney(row.spend))}</span><span class="statistics-data-share">${formatPercent(row.share)}</span><span class="statistics-data-extra">${escapeHtml(row.extra || '')}</span></div>`).join('') || '<div class="empty-state">目前沒有資料</div>'}</div></div>`;
}

function workItemsDetail(workName: string, items: WorkItemDetail[]): string {
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalSpend = items.reduce((sum, item) => sum + item.spend, 0);
  const desktopItems = items.map(item => {
    const quantity = formatQuantity(item.quantity);
    const total = formatMoney(item.spend);
    const unit = item.quantity > 1 ? `${formatMoney(item.unitPrice)} / 件` : '';
    const cost = unit ? `${quantity} 件 · ${unit} · 小計 ${total}` : `${quantity} 件 · ${total}`;
    return `<article class="statistics-work-item"><div class="statistics-work-item-main"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.date)} · ${escapeHtml(item.platform)}</span></div><div class="statistics-work-item-meta"><span>${escapeHtml(cost)}</span></div></article>`;
  }).join('');
  const mobileItems = items.map(item => {
    const quantity = formatQuantity(item.quantity);
    const total = formatMoney(item.spend);
    const cost = item.quantity > 1
      ? `${quantity} 件 · ${formatMoney(item.unitPrice)} / 件 · 小計 ${total}`
      : `${quantity} 件 · ${total}`;
    return `<article class="statistics-work-item-mobile"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.date)} · ${escapeHtml(item.platform)}</span><b>${escapeHtml(cost)}</b></article>`;
  }).join('');
  return `<div class="statistics-work-items"><div class="statistics-work-items-head"><div><span class="eyebrow">WORK ITEM DETAIL</span><h3>${escapeHtml(workName)}</h3></div><div class="statistics-work-items-summary"><span>${formatQuantity(totalQuantity)} 件</span><strong>${formatMoney(totalSpend)}</strong></div></div><div class="statistics-work-items-list statistics-work-items-desktop">${desktopItems}</div><div class="statistics-work-items-mobile-list">${mobileItems}</div></div>`;
}

function openWorkItemsPopup(workName: string, items: WorkItemDetail[]): void {
  const modal = document.createElement('div');
  modal.className = 'statistics-detail statistics-work-popup';
  modal.innerHTML = `<div class="statistics-detail-backdrop" data-stat-close></div><section class="statistics-detail-dialog statistics-work-popup-dialog" role="dialog" aria-modal="true" aria-labelledby="statistics-work-popup-title"><header class="statistics-detail-header"><div><span class="eyebrow">DETAIL</span><h2 id="statistics-work-popup-title">${escapeHtml(workName)}</h2><p>此項目的完整明細。</p></div><button type="button" class="statistics-detail-close" data-stat-close aria-label="關閉詳細明細"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header>${workItemsDetail(workName, items)}</section>`;
  document.body.appendChild(modal);
  document.body.classList.add('statistics-detail-open');
  const close = () => { modal.remove(); document.body.classList.remove('statistics-detail-open'); document.removeEventListener('keydown', keydown); };
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
  qsa<HTMLElement>('[data-stat-close]', modal).forEach(node => node.addEventListener('click', close));
  document.addEventListener('keydown', keydown);
  modal.tabIndex = -1;
  modal.focus();
}

function openDetail(chart: Chart): void {
  const modal = document.createElement('div');
  modal.className = 'statistics-detail';
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  modal.innerHTML = `<div class="statistics-detail-backdrop" data-stat-close></div><section class="statistics-detail-dialog${mobile ? ' statistics-detail-dialog-mobile' : ''}" role="dialog" aria-modal="true" aria-labelledby="statistics-detail-title"><header class="statistics-detail-header"><div><span class="eyebrow">STATISTICS DETAIL</span><h2 id="statistics-detail-title">${escapeHtml(chart.title)}</h2><p>${escapeHtml(chart.description)}</p></div><button type="button" class="statistics-detail-close" data-stat-close aria-label="關閉詳細統計"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header><div class="statistics-summary-grid">${chart.summary.map(item => `<div class="statistics-summary-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div><div class="statistics-large-chart statistics-large-chart-${escapeHtml(chart.id)}" style="--statistics-row-count:${chart.rows.length}">${chartSvg(chart, true)}</div>${detailTable(chart)}</section>`;
  document.body.appendChild(modal);
  document.body.classList.add('statistics-detail-open');
  const close = () => { modal.remove(); document.body.classList.remove('statistics-detail-open'); document.removeEventListener('keydown', keydown); };
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
  qsa<HTMLElement>('[data-stat-close]', modal).forEach(node => node.addEventListener('click', close));
  if (chart.detailItems) {
    qsa<HTMLElement>('.statistics-data-table-row:not(.statistics-data-table-header)', modal).forEach(row => {
      const label = (row.querySelector('.statistics-data-item')?.textContent || '').trim();
      const items = chart.detailItems?.[label];
      if (!items) return;
      row.classList.add('statistics-detail-row-clickable');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const select = () => openWorkItemsPopup(label, items);
      row.addEventListener('click', select);
      row.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    });
  }
  document.addEventListener('keydown', keydown);
  modal.tabIndex = -1;
  modal.focus();
}

function render(charts: Chart[], years: number[]): void {
  const host = qs<HTMLElement>('#statistics-charts');
  if (!host) return;
  host.innerHTML = charts.map(chart => {
    const isMonthly = chart.id === 'monthly-spending';
    const yearControl = isMonthly
      ? `<div class="statistics-year-control" role="group" aria-label="月度年份"><button type="button" class="statistics-year-step" data-stat-year-prev aria-label="上一年">‹</button><span data-stat-year-label>${chart.year ?? currentYear()} 年</span><button type="button" class="statistics-year-step" data-stat-year-next aria-label="下一年">›</button></div>`
      : '';
    return `<article class="statistics-chart-card" data-chart-id="${escapeHtml(chart.id)}"><div class="statistics-chart-heading"><button type="button" class="statistics-chart-open" data-chart-open><span><b>${escapeHtml(chart.title)}</b><small>${escapeHtml(chart.description)}</small></span><i class="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></i></button>${yearControl}</div><button type="button" class="statistics-chart-preview" data-chart-open aria-label="查看${escapeHtml(chart.title)}完整分析">${chartSvg(chart)}</button><span class="statistics-chart-hint">點擊查看完整分析</span></article>`;
  }).join('');

  const monthly = charts.find(chart => chart.id === 'monthly-spending');
  const prev = qs<HTMLButtonElement>('[data-stat-year-prev]', host);
  const next = qs<HTMLButtonElement>('[data-stat-year-next]', host);
  if (monthly) {
    const index = years.indexOf(monthly.year ?? selectedYear);
    if (prev) prev.disabled = index < 0 || index >= years.length - 1;
    if (next) next.disabled = index <= 0;
  }
}

let currentRender: (() => void) | null = null;
async function renderCurrentStats(): Promise<void> { currentRender?.(); }

let unsubscribe: (() => void) | null = null;
function mount(store: MerchStore): void {
  unsubscribe?.();
  const host = qs<HTMLElement>('#statistics-charts');
  if (!host) return;
  if (!host.dataset.statisticsInteractionsBound) {
    host.dataset.statisticsInteractionsBound = 'true';
    host.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const prev = target.closest<HTMLButtonElement>('[data-stat-year-prev]');
      const next = target.closest<HTMLButtonElement>('[data-stat-year-next]');
      if (prev || next) {
        const years = statisticsYears(store.snapshot.items, store.snapshot.shipping ?? []);
        const index = years.indexOf(selectedYear);
        const nextIndex = prev ? index + 1 : index - 1;
        if (nextIndex >= 0 && nextIndex < years.length) {
          selectedYear = years[nextIndex];
          void renderCurrentStats();
        }
        return;
      }
      const open = target.closest<HTMLElement>('[data-chart-open]');
      if (!open) return;
      const card = open.closest<HTMLElement>('[data-chart-id]');
      if (!card) return;
      const charts = aggregateStatistics(store.snapshot.items, store.snapshot.shipping ?? [], selectedYear);
      const chart = charts.find(item => item.id === card.dataset.chartId);
      if (chart) openDetail(chart);
    });
  }
  const renderCurrent = () => {
    const years = statisticsYears(store.snapshot.items, store.snapshot.shipping ?? []);
    if (!years.includes(selectedYear)) selectedYear = years[0] ?? currentYear();
    const charts = aggregateStatistics(store.snapshot.items, store.snapshot.shipping ?? [], selectedYear);
    render(charts, years);
    const currentCharts = aggregateStatistics(store.snapshot.items, store.snapshot.shipping ?? [], currentYear());
    const monthly = currentCharts.find(chart => chart.id === 'monthly-spending');
    const monthValue = monthly?.rows[new Date().getMonth()]?.value ?? 0;
    const monthNode = qs<HTMLElement>('[data-stat="month"]');
    if (monthNode) monthNode.textContent = formatMoney(monthValue);
  };
  currentRender = renderCurrent;
  renderCurrent();
  unsubscribe = store.subscribe(renderCurrent);
}

async function boot(): Promise<void> {
  const host = qs<HTMLElement>('#statistics-charts');
  if (!host) return;
  try { mount(await getStore()); }
  catch { host.innerHTML = '<div class="empty-state wide">統計資料載入失敗</div>'; }
}

void boot();