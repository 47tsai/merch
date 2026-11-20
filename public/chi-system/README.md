# CHI Design System assets

- Version: **v1.2.0**（status／h／merch accent 跟主題色走）
- Source repository: https://github.com/47tsai/chi-system
- Pinned source commit: `a7f018b7836afe42103b717b5379f72a244dfded`

Vendored generated assets (copied verbatim from the CHI `dist/` directory at the
pinned commit; do not edit them in this repository):

- `tokens.css`
- `components.css`
- `theme.js`
- `sidebar.js`

Logo is referenced pinned, not vendored: the logo files are
`logo/merch-b.png` / `logo/merch-w.png` via
`https://raw.githubusercontent.com/47tsai/chi-system/a7f018b7836afe42103b717b5379f72a244dfded/logo/merch-*.png`
(no floating `main` branch). They are not copied into this repository because
the GitHub connector cannot push binary files.

Merch exception — mobile navigation (齊 2026-11-20 定案）:
手機版不使用 chi-system 預設的抽屜式側邊欄與漢堡開關。手機版側邊欄維持 merch
現有做法：≤560px 為底部一排導覽列，561–767px 為左側圖示列；位置、項目、順序、
跳轉都不變，只換殼／token／主題。實作見 `src/chi-shell.css`（手機版覆寫）與
`src/chi-shell-bridge.ts`（擋下抽屜的 inert／Tab 焦點陷阱／遮罩／鎖捲動），
index.html 也不放 `.chi-mobile-header` 漢堡按鈕。桌機版（≥1024px）照 chi-system
側邊欄走，收合鍵 `chi-merch-sidebar-collapsed` 由 `sidebar.js` 管理。

Upgrade by copying a new pinned release and reviewing the merch integration
before deployment.
