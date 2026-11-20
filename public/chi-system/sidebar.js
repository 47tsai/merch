/* chi-system sidebar.js — 側邊欄邏輯唯一來源（SPEC.md §6）
 *
 * 收合開關在側邊欄頂列右側；桌面版點按收合為圖示列；手機版側邊欄藏在畫面外，
 * 另在頁面標頭放同一屬性（data-chi-sidebar-toggle）的開關開抽屜；兩顆按鈕由本檔一併綁定。
 * Cmd／Ctrl＋B 也可切換。用在每頁 <head> 以同步方式引入，放在 theme.js 之後、樣式表之前。
 * 收合 key 只有一個存放位置：<script> 標籤上的 data-chi-sidebar-key，例如：
 *   <script src="./sidebar.js" data-chi-sidebar-key="chi-<站點>-sidebar-collapsed"></script>
 * <aside> 上不寫 key。收合狀態在首次繪製前寫入 <html> 的 data-chi-sidebar-collapsed 屬性，不會閃爍。
 * 規則（皆來自 SPEC.md §6）：
 * - 收合只在桌面（>=1024px）有效；平板（768–1023px）強制圖示列，手機（<768px）為抽屜，
 *   皆不讀收合狀態。CSS 以媒體查詢守住範圍，此檔不判斷寬度來套用收合。
 * - 收合狀態 key 為 chi-<站點>-sidebar-collapsed，值 "1" 為收合、"0" 或無值為展開；
 *   未設定 data-chi-sidebar-key 時只切換當次，不寫入 localStorage。
 * - 抽屜：手機版頁面標頭的開關按鈕 [data-chi-sidebar-toggle] 開，遮罩 [data-chi-sidebar-scrim]
 *   點按與 Escape 關；開啟時鎖住背景捲動，關閉時焦點回到開抽屜的按鈕；視窗放大到 >=768px
 *   時自動關抽屜。
 * - 對外 API：window.ChiSidebar = { bind, isCollapsed, setCollapsed,
 *   toggleCollapsed, openMobile, closeMobile }；收合改變時在 window 派發
 *   chi-sidebar-change 事件，detail 為 { collapsed }。
 */
(function () {
  'use strict';

  var COLLAPSED = '1';
  var MOBILE_MAX = 768;
  var root = document.documentElement;

  // <head> 同步引入時，從自身 <script> 標籤讀本站的 key，先套用收合狀態。
  var currentScript = document.currentScript;
  var key = currentScript ? currentScript.getAttribute('data-chi-sidebar-key') : null;

  function readCollapsed() {
    if (!key) return false;
    try {
      return localStorage.getItem(key) === COLLAPSED;
    } catch (e) {
      return false;
    }
  }

  function writeCollapsed(value) {
    if (!key) return;
    try {
      localStorage.setItem(key, value ? COLLAPSED : '0');
    } catch (e) { /* 忽略：無痕或停用儲存時只切換當次 */ }
  }

  // 首次繪製前套用：只寫 <html> 屬性，CSS 以此守住收合外觀，不碰尚未解析的 DOM。
  if (readCollapsed()) {
    root.setAttribute('data-chi-sidebar-collapsed', COLLAPSED);
  }

  var sidebar = null;
  var triggers = [];
  var scrim = null;
  var lastTrigger = null;
  var boundTriggers = new WeakSet();
  var boundScrims = new WeakSet();
  var documentHandlersBound = false;

  function isMobile() {
    return window.innerWidth < MOBILE_MAX;
  }

  function isCollapsed() {
    return root.getAttribute('data-chi-sidebar-collapsed') === COLLAPSED;
  }

  // 兩顆開關（側邊欄頂列一顆、手機版頁面標頭一顆）用同一屬性，一起更新標籤；
  // 同一時間只顯示其中一顆，標籤邏輯相同。
  function updateTriggerLabel() {
    if (!triggers.length) return;
    var open, collapsed, label, title, expanded;
    if (isMobile()) {
      open = !!sidebar && sidebar.classList.contains('mobile-open');
      label = open ? '關閉導覽選單' : '開啟導覽選單';
      expanded = open ? 'true' : 'false';
    } else {
      collapsed = isCollapsed();
      label = collapsed ? '展開側邊欄' : '收合側邊欄';
      expanded = collapsed ? 'false' : 'true';
    }
    triggers.forEach(function (trigger) {
      trigger.setAttribute('aria-expanded', expanded);
      trigger.setAttribute('aria-label', label);
      trigger.setAttribute('title', label);
    });
  }

  // 關閉的手機抽屜必須退出 Tab 順序與輔助科技瀏覽；桌面側欄則保持可讀。
  function syncMobileAccessibility() {
    if (!sidebar) return;
    var hidden = isMobile() && !sidebar.classList.contains('mobile-open');
    sidebar.inert = hidden;
    sidebar.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  }

  function setCollapsed(collapsed) {
    var next = !!collapsed;
    if (next === isCollapsed()) return;
    if (next) {
      root.setAttribute('data-chi-sidebar-collapsed', COLLAPSED);
    } else {
      root.removeAttribute('data-chi-sidebar-collapsed');
    }
    writeCollapsed(next);
    updateTriggerLabel();
    window.dispatchEvent(new CustomEvent('chi-sidebar-change', { detail: { collapsed: next } }));
  }

  function toggleCollapsed() {
    setCollapsed(!isCollapsed());
  }

  function openMobile() {
    if (!sidebar) return;
    lastTrigger = document.activeElement;
    sidebar.classList.add('mobile-open');
    syncMobileAccessibility();
    if (scrim) scrim.classList.add('visible');
    root.classList.add('chi-sidebar-open');
    updateTriggerLabel();
    var firstLink = sidebar.querySelector('.chi-sidebar__nav a');
    if (firstLink) firstLink.focus();
  }

  function closeMobile(restoreFocus) {
    if (!sidebar) return;
    if (!sidebar.classList.contains('mobile-open')) return;
    sidebar.classList.remove('mobile-open');
    syncMobileAccessibility();
    if (scrim) scrim.classList.remove('visible');
    root.classList.remove('chi-sidebar-open');
    updateTriggerLabel();
    // 跨過 768px 斷點時，原本的手機開關會被 CSS 隱藏，不應把焦點送到隱藏控制項。
    if (restoreFocus !== false && lastTrigger && lastTrigger.focus) lastTrigger.focus();
    lastTrigger = null;
  }

  function onTriggerClick() {
    if (isMobile()) {
      if (sidebar.classList.contains('mobile-open')) {
        closeMobile();
      } else {
        openMobile();
      }
    } else {
      toggleCollapsed();
    }
  }

  function bind() {
    sidebar = document.querySelector('.chi-sidebar');
    if (!sidebar) return;
    // key 只有一個來源：<script data-chi-sidebar-key>。<aside> 上不寫 key，不再回讀。
    triggers = Array.prototype.slice.call(document.querySelectorAll('[data-chi-sidebar-toggle]'));
    triggers.forEach(function (trigger) {
      if (boundTriggers.has(trigger)) return;
      boundTriggers.add(trigger);
      trigger.addEventListener('click', onTriggerClick);
    });
    updateTriggerLabel();
    syncMobileAccessibility();
    scrim = document.querySelector('[data-chi-sidebar-scrim]');
    if (scrim && !boundScrims.has(scrim)) {
      boundScrims.add(scrim);
      scrim.addEventListener('click', closeMobile);
    }
    // bind() is public and may be called after partial DOM updates; global handlers
    // belong to this runtime instance, not to each bind invocation.
    if (documentHandlersBound) return;
    documentHandlersBound = true;
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeMobile();
        return;
      }
      if (event.key !== 'Tab' || !isMobile() || !sidebar.classList.contains('mobile-open')) return;
      var focusable = sidebar.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (!sidebar.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    window.addEventListener('resize', function () {
      if (!isMobile()) closeMobile(false);
      syncMobileAccessibility();
      updateTriggerLabel();
    });
    document.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'b' || event.key === 'B')) {
        var target = event.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
        event.preventDefault();
        onTriggerClick();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.ChiSidebar = {
    bind: bind,
    isCollapsed: isCollapsed,
    setCollapsed: setCollapsed,
    toggleCollapsed: toggleCollapsed,
    openMobile: openMobile,
    closeMobile: closeMobile,
  };
})();