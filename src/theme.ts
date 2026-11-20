import './theme.css';
import './theme-refinement.css';

// chi-system 首頁試點：主題邏輯唯一來源是 vendored 的 chi-system theme.js
//（public/chi-system/theme.js，在 <head> 同步載入，key 為 chi-theme-mode，
//生效主題寫在 data-chi-theme）。這檔只是薄包裝：把設定頁的三態按鈕
//（[data-theme-choice]）接到 window.ChiTheme，並同步按鈕狀態與說明文字。
// 舊的 merch-theme localStorage key 不再使用、不搬移（SPEC：舊 key 不搬移，
// 遷移後第一次開啟為 system，跟隨系統）。

type Theme = 'light' | 'dark' | 'system';

type ChiTheme = {
  getMode: () => Theme;
  getEffective: () => 'light' | 'dark';
  setMode: (mode: Theme) => void;
  bindToggles: () => void;
};

declare global {
  interface Window {
    ChiTheme?: ChiTheme;
  }
}

function getChiTheme(): ChiTheme | undefined {
  return window.ChiTheme;
}

function syncSettingsUI(): void {
  const chi = getChiTheme();
  if (!chi) return;
  const mode = chi.getMode();
  const effective = chi.getEffective();
  // 相容墊片：merch 舊 CSS 用 html[data-theme='dark'] 區分深色
  //（chi-library-tokens.css、design-tokens.css），主題切換時一併鏡像，
  //等全站 token 遷完再移除。data-chi-theme 仍是正式來源。
  document.documentElement.dataset.theme = effective;
  document.documentElement.dataset.themePreference = mode;
  document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((button) => {
    const active = button.dataset.themeChoice === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const status = document.querySelector<HTMLElement>('[data-theme-status]');
  if (status) {
    status.textContent =
      mode === 'system'
        ? `跟隨系統 · ${effective === 'dark' ? '深色' : '淺色'}`
        : effective === 'dark'
          ? '深色模式'
          : '淺色模式';
  }
}

function init(): void {
  syncSettingsUI();
  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-theme-choice]');
    const theme = button?.dataset.themeChoice;
    if (theme === 'system' || theme === 'dark' || theme === 'light') {
      getChiTheme()?.setMode(theme);
      syncSettingsUI();
    }
  });
  // theme.js 切換（側邊欄底部按鈕）或系統主題改變時，同步設定頁 UI。
  window.addEventListener('chi-theme-change', syncSettingsUI);
  // theme.js 在 DOMContentLoaded 綁定切換鈕；若本模組先跑，補綁一次（bindToggles 可重複呼叫）。
  getChiTheme()?.bindToggles();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
