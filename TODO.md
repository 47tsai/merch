# Merch TODO

## Current state

- **目前開發版本：`2.0.37`。**
- `RULES.md`：長期開發規則。
- `ITEM_SCHEMA.md`：Item 資料契約。
- `ITEM_TYPES.md`：Category registry。
- `PROJECT_ARCHITECTURE.md`：repository 與資料／部署責任邊界。
- `UI_ARCHITECTURE.md`：共用 UI 與 responsive baseline。
- 本文件只保留尚未完成的工作。

### CSS 載入盤點（2026-10-18）

- 已確認 `main.ts` 是主要 CSS 入口，依序載入 legacy `styles.css`、Chi tokens/components 與 MERCH page styles；`theme.ts` 另載入主題樣式。
- `styles.css` 約 9.1 KB、`merch.css` 約 35.1 KB；兩者有大量同名 selector，但目前比對未發現可直接整段刪除的完全相同 selector/declaration，因此不可只依 selector 重複就移除。
- `collection.css` 與 `item-detail-modal.css` 含頁面／元件專屬覆寫；先保留。下一步應取得瀏覽器 CSS coverage 或 build 產物後，再按實際未使用規則逐項清理。

### 最近修正

- `2.0.37`：統一全站危險操作按鈕的預設外觀，改為淡紅底、紅色文字，並明確覆蓋 legacy 與 Chi button 的 hover/active 樣式，避免文字與背景對比不足。

### PageSpeed / 效能改善

- [ ] 盤點封面圖與詳情圖的格式、尺寸及實際傳輸量，優先處理最大的圖片資產。
- [ ] 檢查靜態資產與資料 API 的 Cache-Control，確認版本化資產可長快取、動態資料不會被錯誤快取。
- [ ] 以實際入口依賴圖整理 CSS 載入順序，確認共用 tokens 只由入口載入一次。
- [ ] 以 build 產物與瀏覽器覆蓋率定位未使用 CSS，只有確認無引用並完成視覺驗收後才移除。
- [ ] 在正式網站檢查桌面首頁與收藏頁的 CLS，記錄造成位移的元素與修正結果。
- [ ] 檢查互動控制項的名稱、鍵盤操作、焦點可見性及非互動標籤語意。
- [ ] 用效能剖析定位手機端長任務，優先處理大量收藏渲染、搜尋與圖片載入。
- [ ] 檢查首屏 JavaScript 與字型載入策略，避免不必要的同步工作及文字閃爍。
- [ ] 盤點非必要動畫與 layout-triggering transition，尊重 `prefers-reduced-motion`。

### 全站整合驗收

- [ ] 執行完整 Build 與 TypeScript 檢查，確認全站 CSS／模組載入順序。
- [ ] 驗收 Desktop、Tablet、Mobile 的導覽、各頁版面與 Modal。
- [ ] 驗收 Light、Dark、System 三種主題及系統主題即時變更。
- [ ] 驗收 Chi Auth 登入／登出、收藏 CRUD、圖片管理、作品管理與運費關聯。
- [ ] 清理歷史 CSS 重複規則與舊版樣式，確認每次移除都有視覺回歸檢查。
- [ ] 驗收最新介面修正：統計圖表品牌紫色、深色模式新增頁固定操作列、頁首非互動標籤移除。
