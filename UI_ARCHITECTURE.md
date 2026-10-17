# Merch UI Architecture

> 本文件描述目前正式 UI 的責任分層與 layout baseline。不可回歸規則以 `RULES.md` 為準；待完成工作以 `TODO.md` 為準。

## 1. UI scope

正式頁面：

- Home
- Collection
- Statistics
- Add
- Shipping
- Management
- Settings
- Item Detail

共用 surface：

- Navigation / Header
- Button
- Input / Select / Segmented Control
- Card / Panel
- Badge
- Modal / Dialog
- Toast / Feedback
- Loading / Empty / Error
- Sync overlay

## 2. Layer model

```text
Design Tokens
     │
     ├── Theme
     ├── Shared Components / Controls
     └── Responsive Contract
              │
              ▼
        Page Modules
              │
              ▼
        Store / Router / API
```

### Design foundation

- `src/design-tokens.css`：semantic color、typography、spacing、radius、border、surface、focus、shadow。
- `src/theme.ts` / `src/theme.css` / `src/theme-refinement.css`：Light / Dark theme。
- `src/shared-components.css`：Button、Card、Panel、Modal、Badge、Feedback 等共用視覺基礎。
- `src/controls.css`：Input、Select、Segmented Control 等控制項。
- `src/merch.css`：正式介面的統一視覺、版面與 Desktop / Tablet / Mobile breakpoint。

Shared foundation 是唯一共用 UI 層。舊 API 若仍存在，只能 forwarding，不建立第二套視覺實作。

## 3. Page layer

Page module 負責：

1. 該頁資料整理。
2. 該頁事件處理。
3. 該頁 rendering。
4. 該頁真正獨有的 layout。

Page module 不應：

- 建立第二份 remote state。
- 直接修改 Store snapshot。
- 重建 shared Button / Modal / Card 等元件。
- 在自己的 CSS 宣告 viewport breakpoint 取代 responsive layer。
- 透過 DOM post-processing 修補 rendering lifecycle。

## 4. State and rendering

### State

Store 是資料與 UI state 的主要來源。

```text
API response
   ↓ validation
Store
   ↓ immutable state
Page rendering
```

Remote mutation：

```text
User action
   ↓
API
   ↓
remote mutation
   ↓ authoritative response
Store remote-apply
   ↓
render
```

Page 不應在 mutation 成功後另外維護一份與 Store 平行的遠端資料。

### Rendering lifecycle

資料驅動區塊至少區分：

- Loading
- Ready
- Empty
- Error

Empty 不是 Error。Error message 必須是安全、可理解的 UI 文案，不直接把原始 exception 當 HTML。

## 5. Shared interaction contract

共用互動至少處理：

- hover
- focus-visible
- disabled
- loading
- keyboard navigation
- reduced-motion
- error / empty feedback

HTML `id` 必須唯一。

動態事件優先使用穩定的事件 delegation；不可在每次 render 重複註冊相同 document listener。

不使用 MutationObserver、`dataset.bound` 或類似標記作為 lifecycle workaround。

## 6. Modal / Dialog

Modal 與 Item Detail 必須維持完整 lifecycle：

- open / close
- Escape
- focus trap
- focus return
- keyboard interaction
- `aria-hidden`
- 正確的 dialog selector

Detail dialog 不可與其他 modal 使用模糊 selector 混淆。

## 7. Navigation

Mobile Navigation 使用固定於底部的可橫向滑動導覽列，圖示搭配文字標籤，並支援 iPhone safe area。Mobile 不保留 Desktop sidebar 的佔位空間。

Route navigation 與 page rendering 解耦；跨頁搜尋／Filter 必須由 cross-navigation 與 Collection state 一起更新，而不是只修改 hash。

## 8. Responsive baseline

### Desktop

- 完整 Navigation / Header。
- 內容保持合理最大寬度。
- 多欄資訊維持清楚的 hierarchy。

### Tablet

- Grid 可縮減欄數。
- 文字、金額與操作控制不可溢出。
- 必要時重新分配欄寬或排列順序。

### Mobile

- 導覽採底部水平滑動列，顯示圖示與文字標籤。
- 不保留 Desktop sidebar 空間，並預留 safe area。
- Form、Modal、Ranking、Statistics、Management 依可用寬度重新安排，而不是單純縮小 Desktop。

正式介面的 viewport breakpoint 集中於 `src/merch.css`。

## 9. Accessibility baseline

正式 UI 必須考慮：

- semantic HTML
- keyboard navigation
- visible focus
- dialog focus lifecycle
- disabled / loading state 的可理解性
- 圖片 `alt`
- reduced-motion
- 足夠的文字與背景對比

## 10. Current shared UI files

| 檔案 | 責任 |
|---|---|
| `src/design-tokens.css` | Design tokens |
| `src/theme.ts` / `theme.css` / `theme-refinement.css` | Theme |
| `src/shared-components.css` | Shared visual components |
| `src/controls.css` | Shared form controls |
| `src/merch.css` | 正式 UI、Design Tokens alias、Responsive contract |
| `src/app-loading.*` | Initial loading |
| `src/sync-overlay.*` | Blocking sync state |
| `src/page-auth-status.*` | Page auth status |
| `src/image-viewer.*` | Image viewer |
| `src/detail-focus.ts` | Dialog / detail focus lifecycle |
| `src/utils/toast.ts` | Legacy Toast API forwarding |

## 11. Verification baseline

UI 修改至少檢查：

- Light / Dark
- Desktop / Tablet / Mobile
- hover / focus-visible / disabled / loading
- Loading / Empty / Error
- keyboard navigation
- reduced-motion
- Modal / Detail lifecycle
- Collection search / filter / sort
- Add / Edit / Delete
- Shipping
- 圖片 fallback

## 12. Maintenance boundary

本文件不保存已完成 redesign 的歷史 checklist，也不保存一次性 bug fix。

當發現舊 UI implementation 與 shared foundation 重複時：

1. 先記錄到 `TODO.md`。
2. 確認實際 import、selector、rendering 與責任範圍。
3. 合併到正確的 shared layer。
4. 移除舊 implementation。
5. 驗證所有受影響頁面。
