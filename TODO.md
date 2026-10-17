# Merch TODO

## Current state

- **目前開發版本：`2.0.30`。**
- `RULES.md`：長期開發規則。
- `ITEM_SCHEMA.md`：Item 資料契約。
- `ITEM_TYPES.md`：Category registry。
- `PROJECT_ARCHITECTURE.md`：repository 與資料／部署責任邊界。
- `UI_ARCHITECTURE.md`：共用 UI 與 responsive baseline。
- 本文件只保留尚未完成的工作。

### PageSpeed / 效能改善

- [ ] 圖片傳輸最佳化...
- [ ] Cache lifetime 最佳化...
- [ ] CSS 載入管線整理...
- [ ] CSS 使用量最佳化...
- [ ] Desktop CLS 排查...
- [ ] Accessibility / Agent Browsing 語意修正...
- [ ] Mobile 主執行緒負載優化...
- [ ] Legacy JavaScript / Font display...
- [ ] 動畫與非 composited animation...

### 全站整合驗收

- [ ] 執行完整 Build 與 TypeScript 檢查，確認全站 CSS／模組載入順序。
- [ ] 驗收 Desktop、Tablet、Mobile 的導覽、各頁版面與 Modal。
- [ ] 驗收 Light、Dark、System 三種主題及系統主題即時變更。
- [ ] 驗收 Chi Auth 登入／登出、收藏 CRUD、圖片管理、作品管理與運費關聯。
- [ ] 清理歷史 CSS 重複規則與舊版樣式，確認每次移除都有視覺回歸檢查。
