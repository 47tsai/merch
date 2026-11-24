import './home-enhancements.css';
import { getStore, type MerchStore } from './store';
import { aggregateCharacterSpending, characterItemCounts, rankAt, rankValueAt, type CharacterRankingRow } from './home-ranking';
import { itemValue } from './utils/item-math';
import { escapeHtml } from './utils/dom';
import { formatMoney as money } from './utils/format';

let storeRef: MerchStore | null = null;
let characterModal: HTMLElement | null = null;
let workModal: HTMLElement | null = null;

function getWorkRows(store: MerchStore) {
  const spendingByWork = new Map<string, number>();
  store.snapshot.items.forEach((item) => {
    const name = item.workName || '未分類';
    spendingByWork.set(name, (spendingByWork.get(name) || 0) + itemValue(item));
  });
  return store.snapshot.works
    .map((work) => ({ name: work.name, spend: spendingByWork.get(work.name) || 0 }))
    
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name, 'zh-Hant'));
}

// Spending and count rules live in home-ranking.ts so they can be tested;
// see the note there on why the two numbers on one line use different bases.
function getCharacterRows(store: MerchStore): CharacterRankingRow[] {
  return aggregateCharacterSpending(store.snapshot.items);
}

function getCharacterItemCounts(store: MerchStore): Map<string, number> {
  return characterItemCounts(store.snapshot.items);
}

function renderWorkRankingRows(list: HTMLElement, rows: ReturnType<typeof getWorkRows>, limit = 5): void {
  const visibleRows = rows.slice(0, limit);
  const max = visibleRows[0]?.spend || 1;
  const ranks = visibleRows.map((row) => row.spend);
  list.className = 'home-ranking-list work-ranking-list';
  list.innerHTML = visibleRows.length
    ? visibleRows.map((row, index) => {
      const progress = Math.max(2, Math.round(row.spend / max * 100));
      const rank = rankValueAt(ranks, index);
      return `
      <li class="ranking-line work-ranking-line" data-search-query="${escapeHtml(row.name)}" role="link" tabindex="0" aria-label="搜尋作品 ${escapeHtml(row.name)}">
        <span class="ranking-position" aria-hidden="true">${String(rank).padStart(2, '0')}</span>
        <div class="ranking-content">
          <div class="ranking-heading"><strong class="ranking-title" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</strong><b class="ranking-value">${escapeHtml(money(row.spend))}</b></div>
          <div class="ranking-meter" aria-label="消費比例 ${progress}%"><span style="width:${progress}%"></span></div>
        </div>
      </li>`;
    }).join('')
    : '<li class="home-ranking-empty">目前沒有資料</li>';
}

function renderCharacterList(list: HTMLElement, rows: CharacterRankingRow[], limit = 5): void {
  const visibleRows = rows.slice(0, limit);
  const max = visibleRows[0]?.[1] || 1;
  const counts = storeRef ? getCharacterItemCounts(storeRef) : new Map<string, number>();
  list.className = 'character-ranking-list';
  list.innerHTML = visibleRows.length
    ? visibleRows.map(([character, spend], index) => {
      const progress = Math.max(2, Math.round(spend / max * 100));
      const count = counts.get(character) || 0;
      const rank = rankAt(rows, index);
      return `
      <li class="ranking-line work-ranking-line" data-search-query="${escapeHtml(character)}" role="link" tabindex="0" aria-label="搜尋角色 ${escapeHtml(character)}">
        <span class="ranking-position" aria-hidden="true">${String(rank).padStart(2, '0')}</span>
        <div class="ranking-content">
          <div class="ranking-heading"><strong class="ranking-title" title="${escapeHtml(character)}">${escapeHtml(character)} · ${count} 件</strong><b class="ranking-value">${escapeHtml(money(spend))}</b></div>
          <div class="ranking-meter" aria-label="消費比例 ${progress}%"><span style="width:${progress}%"></span></div>
        </div>
      </li>`
    }).join('')
    : '<li class="home-ranking-empty">目前沒有資料</li>';
}

function ensureWorkModal() {
  if (workModal) return workModal;
  const modal = document.createElement('div');
  modal.className = 'item-detail-modal';
  modal.hidden = true;
  modal.innerHTML = `<div class="item-detail-backdrop" data-work-ranking-close></div><section class="item-detail-dialog work-ranking-dialog" role="dialog" aria-modal="true" aria-labelledby="work-ranking-title"><button type="button" class="item-detail-close" aria-label="關閉" data-work-ranking-close><svg class="fa-inline" viewBox="0 0 384 512" aria-hidden="true" focusable="false"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/></svg></button><div class="item-detail-heading"><span class="eyebrow">WORK SPENDING RANKING</span><h2 id="work-ranking-title">作品消費總排行</h2><p>依消費金額由高至低排序，點擊作品可直接搜尋。</p></div><div id="work-ranking-all" class="work-ranking-list" role="list"></div></section>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-work-ranking-close]').forEach((node) => node.addEventListener('click', closeWorkModal));
  workModal = modal;
  return modal;
}

function openWorkModal() {
  if (!storeRef) return;
  const modal = ensureWorkModal();
  const list = modal.querySelector<HTMLElement>('#work-ranking-all');
  if (list) renderWorkRankingRows(list, getWorkRows(storeRef), 999);
  modal.hidden = false;
  document.body.classList.add('detail-modal-open');
}

function closeWorkModal() {
  if (!workModal) return;
  workModal.hidden = true;
  document.body.classList.remove('detail-modal-open');
}

function ensureCharacterModal() {
  if (characterModal) return characterModal;
  const modal = document.createElement('div');
  modal.className = 'item-detail-modal';
  modal.hidden = true;
  modal.innerHTML = `<div class="item-detail-backdrop" data-character-close></div><section class="item-detail-dialog favorite-character-dialog" role="dialog" aria-modal="true" aria-labelledby="character-title"><button type="button" class="item-detail-close" aria-label="關閉" data-character-close><svg class="fa-inline" viewBox="0 0 384 512" aria-hidden="true" focusable="false"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/></svg></button><div class="item-detail-heading"><span class="eyebrow">CHARACTER SPENDING</span><h2 id="character-title">角色消費排行</h2><p>依角色分攤後的消費金額排序；金額由多角色商品均分，件數為每位角色各計一件，點擊角色可直接搜尋。</p></div><ul id="character-list-all" class="character-ranking-list"></ul></section>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-character-close]').forEach((node) => node.addEventListener('click', closeCharacterModal));
  characterModal = modal;
  return modal;
}

function openCharacterModal() {
  if (!storeRef) return;
  const modal = ensureCharacterModal();
  const list = modal.querySelector<HTMLElement>('#character-list-all');
  if (list) renderCharacterList(list, getCharacterRows(storeRef), 999);
  modal.hidden = false;
  document.body.classList.add('detail-modal-open');
}

function closeCharacterModal() {
  if (!characterModal) return;
  characterModal.hidden = true;
  document.body.classList.remove('detail-modal-open');
}

function syncHomeRankings(): void {
  if (!storeRef) return;
  const workList = document.querySelector<HTMLElement>('#work-bars');
  const characterList = document.querySelector<HTMLElement>('#favorite-character-list, #character-ranking');
  if (workList) renderWorkRankingRows(workList, getWorkRows(storeRef));
  if (characterList) renderCharacterList(characterList, getCharacterRows(storeRef));
}

function addMoreButton(panel: HTMLElement, label: string, handler: () => void): void {
  if (panel.querySelector('.home-ranking-more')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'home-ranking-more';
  button.textContent = label;
  button.addEventListener('click', handler);
  panel.appendChild(button);
}

function install() {
  const rankingPanel = document.querySelector<HTMLElement>('.ranking-panel');
  if (rankingPanel && !rankingPanel.dataset.enhancementInstalled) {
    rankingPanel.dataset.enhancementInstalled = 'true';
    rankingPanel.classList.add('favorite-character-panel');
    const label = rankingPanel.querySelector<HTMLElement>('.panel-label');
    const heading = rankingPanel.querySelector<HTMLElement>('h2');
    const list = rankingPanel.querySelector<HTMLElement>('#character-ranking');
    if (label) label.textContent = 'CHARACTERS';
    if (heading) heading.textContent = '角色消費排行';
    if (list) {
      list.id = 'favorite-character-list';
      list.className = 'character-ranking-list';
    }
    addMoreButton(rankingPanel, '查看全部角色 →', openCharacterModal);
  }

  const workPanel = document.querySelector<HTMLElement>('#work-bars')?.closest<HTMLElement>('.panel');
  if (workPanel && !workPanel.dataset.enhancementInstalled) {
    workPanel.dataset.enhancementInstalled = 'true';
    workPanel.classList.add('home-work-panel');
    addMoreButton(workPanel, '查看全部作品排行 →', openWorkModal);
  }
}

void getStore().then((store) => {
  storeRef = store;
  install();
  syncHomeRankings();
  store.subscribe(syncHomeRankings);
}).catch(() => undefined);
