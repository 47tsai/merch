// chi-system 首頁試點：手機版底部導覽橋接。
//
// 背景：齊 2026-11-20 定案，手機版側邊欄維持 merch 現有底部一排導覽，
// 不改成 chi-system 預設的抽屜式側邊欄／漢堡開關。但桌機收合仍由 chi
// sidebar.js 管理，所以 sidebar.js 照常載入；這檔只擋下它在 <768px 時
// 的抽屜行為：
//  - sidebar.js 會把未開啟的抽屜設 inert + aria-hidden（導覽點不到、
//    讀屏也看不到），這裡用 MutationObserver 在它每次設定後立即清掉。
//  - Cmd/Ctrl+B 在 <768px 會開抽屜（focus 跳去第一個連結、遮罩、鎖捲動），
//    這裡在 capture 階段攔下。
//  - 遮罩與捲動鎖定由 src/chi-shell.css 蓋掉（.chi-sidebar__scrim 不顯示、
//    html.chi-sidebar-open body 不鎖捲動）。
// index.html 沒有放 .chi-mobile-header 漢堡按鈕，所以手機上沒有任何入口
// 可以開抽屜；桌機（>=768px）不受影響。

const MOBILE_MAX = 768;

function isMobile(): boolean {
  return window.innerWidth < MOBILE_MAX;
}

function assertMobileNav(): void {
  if (!isMobile()) return;
  const sidebar = document.querySelector<HTMLElement>('.chi-sidebar');
  if (!sidebar) return;
  // sidebar.js 的 syncMobileAccessibility() 會在 bind／resize／開關抽屜時
  // 重設這兩個值；Observer 會在屬性變動後再清一次，這裡是第一次與 resize 時的補位。
  sidebar.inert = false;
  sidebar.removeAttribute('aria-hidden');
}

function init(): void {
  const sidebar = document.querySelector<HTMLElement>('.chi-sidebar');
  if (sidebar) {
    const observer = new MutationObserver(() => assertMobileNav());
    observer.observe(sidebar, { attributes: true, attributeFilter: ['inert', 'aria-hidden', 'class'] });
  }
  assertMobileNav();
  window.addEventListener('resize', assertMobileNav);
  document.addEventListener(
    'keydown',
    (event) => {
      if (!isMobile()) return;
      if ((event.metaKey || event.ctrlKey) && (event.key === 'b' || event.key === 'B')) {
        // 擋下 sidebar.js 的 Cmd/Ctrl+B 開抽屜（手機版沒有抽屜可開）。
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
