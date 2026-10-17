# Merch 開發規則

> 本文件只保存會長期影響開發、資料、部署或維護方式的規則。一次性工作、已完成事項與待驗證事項放在 `TODO.md`。修改前必讀。

## 1. 修改原則

- 修改前先讀 `RULES.md`、`TODO.md`，確認現有實作、資料結構與可重用邏輯。
- 小問題採最小必要修改；若根因位於共用架構、狀態、資料流或元件邊界，必須修正根因，不以 workaround 掩蓋。
- 修改既有功能時先找到舊實作。新實作若取代舊實作，必須清除舊路徑，不讓新舊邏輯長期並存。
- 共用行為應放在共用元件、Store、utility、design token 或正確 rendering 層，不在各頁重複修補。
- 不以「看起來能用」取代驗證。發現確定問題時先記錄到 `TODO.md`，再處理；完成後移除對應 TODO。
- `merch-old` 僅作 UI／UX 與功能參考，不直接複製舊版程式碼。

## 2. 技術與資料架構

- 技術基礎：TypeScript + Vite + ES Modules。
- `src/` 是應用程式邏輯；`data/` 是 canonical data；`public/data/` 是 build 產生的部署資料。
- GitHub Pages 為正式前端部署環境，正式網站為 `merch.chi.qzz.io`。
- Store 是資料與 UI state 的主要來源。Page 不建立與 Store 不一致的第二份資料狀態。
- State 採 immutable 更新，不直接修改 Store snapshot。
- 所有外部資料都視為不可信。API response、static data、mutation response 與 Worker 輸入必須經適當 validation／schema boundary。
- 正式 Item 採 `data/<work>/<category>/<item-id>/data.json`；圖片位於同一 Item 的 `images/`。
- 不恢復舊式整份作品 JSON 作為 Item 寫入方式。
- `public/data/collection.json` 是 build 產生的 read model，不手動加入 Item。
- `data/works.json` 僅在作品本身變更時更新；單純新增 Item 不得無故修改。

### Item ID

- Item ID 是穩定識別碼；既有 Item 不因排序、分類或搬移而改 ID。
- 格式為「作品代碼 + 歷史類型 code + 三位流水號」；歷史類型 code 與目前 `category` 是不同概念。
- 新 ID 必須檢查完整 repository 的 Item 集合，確保唯一。已刪除 ID 可重新使用，但不得與現存 Item 重複。
- Worker 判斷 Item 所屬 Work 時必須解析完整 Work Code 精確比對，不得使用可能碰撞的前綴判斷。
- 載入 Item Map 發現重複 ID 時必須拒絕繼續，不得靜默覆蓋。

### Category / Quantity

- Category code、名稱與分類規則以 `ITEM_TYPES.md` 為唯一來源，不在其他地方維護另一套 category 定義。
- `亞克力` 是材質，不是獨立 category；分類依實際商品型態。
- 修改 category 前先更新 `ITEM_TYPES.md`，再檢查 validation、ID、路徑、搜尋與 UI。
- Management 的 Work selector 使用永久 `work.id`，不以作品名稱作 state key。
- `quantity` 必須是大於等於 1 的整數。舊資料缺少 quantity 時可相容預設為 `1`，格式錯誤不得靜默轉成 1。
- 所有進入 Store 的 Item 都經一致的 quantity validation／normalization。
- 種類數 = Item 筆數；持有件數 = `Σ quantity`；單項價值 = `purchase.price × quantity`。

## 3. UI、Rendering、Accessibility

- 全站 Navigation、Header、Card、Panel、Button、Input、Modal、Badge、Toast 等遵循共同視覺語言。
- 色彩、Typography、Spacing、Radius、Border、Surface、Focus、Shadow 等以 semantic design tokens 為單一來源，不建立 page-specific token alias。
- 共用 Button、Input、Select、Segmented Control、Card、Panel、Modal、Badge、Feedback 優先使用 shared foundation，不為單一頁重建第二套元件。
- Desktop、Tablet、Mobile，以及 Light、Dark 都屬正式 UI contract。
- 正式介面的 viewport responsive 規則集中於 `src/merch.css`，不得保留第二套 preview UI 或重複 refinement stylesheet。
- Mobile Navigation 採固定底部、可水平滑動且具文字標籤的導覽列，支援 safe area，不保留 Desktop sidebar 佔位空間。
- 互動需處理 hover、focus-visible、disabled、loading、empty、error。
- HTML `id` 必須唯一。
- 動態互動優先使用事件 delegation，不在每次 render 重複新增 document listener。
- 不使用 MutationObserver 作為 UI state、搜尋、排序或資料顯示的後處理 workaround，也不以 `dataset.bound` 等標記掩蓋 lifecycle 問題。
- 優先使用 DOM API、`textContent` 與安全 utility；未處理外部字串不得直接進入 `innerHTML`。
- Data-driven UI 必須區分 Loading、Empty、Error。錯誤訊息應為安全且可理解的 UI 文案。
- Modal／Detail 必須正確處理 focus trap、focus return、Escape、`aria-hidden`、鍵盤操作與專用 selector。
- Route navigation 與 page rendering 解耦。

## 4. Search、Collection、Statistics

### Search / Collection

- 搜尋涵蓋使用者可辨識的名稱、角色、作品、類型、廠商、Item ID 等。
- 多搜尋詞採 AND 邏輯；空白、`,`、`，` 等常見分隔方式需正確處理。
- 使用者可見狀態與內部狀態搜尋保持一致；`待到貨` 包含 `pending + preorder`。
- Search、Filter、Sort、View mode 不得各自維護互相矛盾的狀態。
- Collection 數量顯示以 `quantity` 為實際件數；Item 筆數與件數分開。
- 圖片失敗必須有 fallback；點擊 Item 進入 Detail。

### Statistics

- 統計資料來源與計算方式必須明確。
- 「數量」預設為 `Σ quantity`；只有明確標示「種類」時才使用 Item 筆數。
- 消費為 `Σ(purchase.price × quantity)`。
- 月份統計完整處理 1～12 月，無資料月份顯示 0。
- 統計頁需處理空資料、邊界值、手機版與轉跳 Collection 時的 query／filter state。

## 5. Router / Navigation

- 使用 Hash Router，正式 routes：`#/home`、`#/collection`、`#/statistics`、`#/add`、`#/shipping`、`#/management`、`#/settings`、`#/item/:id`。
- Refresh、Back、Forward 必須正常。
- malformed URL、decode 失敗、多餘 segments、不存在 Item 必須安全處理，不得白屏。
- 未知 route 保留 404 語意，不為了回復正常而強制導向 Home。
- 從 Statistics、Ranking、Dashboard 等位置跳到 Collection 時，除了 hash，還必須同步更新 Collection query／filter state。

## 6. Management / CRUD

- 作品、類型、流水號選擇器與搜尋狀態保持一致。
- CRUD 必須具備 validation、刪除確認、成功／失敗回饋。
- 新增／編輯不得產生重複 ID 或破壞既有資料；編輯不得因無關 render 遺失使用者輸入。
- Management 不得直接修改 frozen Store snapshot，應建立新的資料物件後提交。
- Work CRUD 不得無故修改 Shipping state；只有明確的 Shipping 操作才能改動相關資料。

## 7. API / Worker / Remote Mutation

- Frontend 不保存或暴露 GitHub Token；GitHub 寫入必須經 API／Worker layer。
- API、Worker 必須驗證輸入與 response。
- Remote mutation 必須序列化，避免並行 mutation 造成 stale overwrite。
- 正式管理 mutation 必須透過 Worker 建立 GitHub commit 並更新 `main`；該 commit 必須觸發 `Verify`，且 `Verify` 成功後由 `Deploy` workflow 發布 GitHub Pages，讓管理操作最終反映到正式網站。
- mutation 成功後，以 API authoritative response 經 Store 的 remote-apply 流程更新 UI，不由各 Page 自行重建遠端狀態。
- 共用 Store load promise 失敗後必須清除，使後續操作仍可重新載入或進入既定 fallback。
- 寫入只修改目標 Item、index 或必要的跨檔案資料，不覆寫無關 Item。
- 遠端寫入採最小範圍與 atomic commit。
- GitHub branch 更新以觀測到的最新 remote HEAD 為 parent，避免 force update；競爭或過期操作必須失敗，不得靜默覆蓋其他修改。
- 跨檔案搬移必須有一致性與 rollback 策略。
- API／Worker／Store 必須遵守目前 Item 與 index 路徑，不恢復舊作品 JSON 整份覆寫模式。

### Sync UX

- 新增、編輯、刪除、運費與圖片操作在 mutation 尚未送出前，必須顯示明確同步／上傳狀態並阻止會造成衝突的操作。
- mutation 的 UI「完成」定義為：裝置非離線、管理驗證已完成，且請求已可靠進入送出流程；不要求等待遠端最終 response 才解除 UI 阻塞或顯示已送出。
- API 最終 response 仍必須在背景完成 validation，並用 authoritative data 做 reconciliation；若遠端 mutation 失敗，需重新同步遠端狀態，不得把錯誤 response 當成未送出的理由。
- 不使用全域 `fetch` monkey patch 判斷 mutation 狀態。

## 8. Image Management

- 支援 JPG、JPEG、PNG、WebP、GIF、AVIF。
- 單檔大小限制由目前 API／UI contract 定義，Frontend 與 Worker 必須一致。
- 圖片位於 `data/<work>/<category>/<item>/images/`，metadata 必須與實際檔案一致。
- 封面只能有正確的封面標記；排序只改 metadata 順序，不改 Item ID 或檔名。
- 替換圖片採「先寫入新圖片與 metadata，再清理舊圖片」；清理失敗不得讓已成功的新圖片操作被視為失敗。
- 刪除圖片必須同時維護 metadata 與遠端檔案一致性，失敗時保留可恢復狀態。
- R2 是圖片 asset layer；GitHub metadata 是 canonical metadata mutation。兩者操作必須有明確一致性與 rollback 行為。
- 圖片新增、替換與刪除都屬正式 mutation；圖片管理程式碼修改必須增加 Patch version。

## 9. 大量新增周邊

- 大量新增前先完整整理、去重、確認 Work、Category、欄位與 ID，再批次寫入，不逐筆邊收到邊寫。
- 作品以永久 `work.id` 確認，不只依顯示名稱猜路徑。
- Category 依 `ITEM_TYPES.md` 判定；材質不得直接當 category。
- 新 Item 依完整 repository 集合檢查 ID 唯一性。
- 每筆 Item 建立自己的 `data/<work>/<category>/<item-id>/data.json`；不得恢復舊作品整份 JSON。
- canonical Item JSON 只放 schema 允許欄位，不自行加入 `workName`、`shipping`、`material`、`release`、`createdAt`、`updatedAt` 等非 schema 欄位。
- 使用者沒有提供且 repository 無法可靠推導的資料不得猜測，包括價格、日期、描述、圖片等。
- 使用者提供圖片時，只建立實際存在的圖片檔案與 metadata reference。
- 批次新增仍必須完成 schema、quantity、category、ID、路徑、圖片與 data integrity 驗證。
- canonical data 完成後由 build 執行 `sync-public-data.mjs` 與 `generate-collection.mjs`；不得手動把 Item 塞進 generated `public/data/`。
- 大量新增完成後至少驗證 data integrity、schema、ID uniqueness、collection read model 與 build；已部署則確認 CI。

## 10. Version / Verification / Release

### Version

- `package.json` 的 `version` 是唯一正式版本來源。
- `public/data/version.json` 是由 `package.json` 產生的部署資料；使用 `npm run version:sync` 同步，不手動維護另一個版本來源。
- Worker 的 `WORKER_VERSION` 是獨立版本，只代表 Worker 實作／部署版本，不要求與網站版本一致。
- 只有 Worker 實作或 Worker 部署本身變更時，才需要更新 Worker version；單純前端、資料或文件變更不必更新 Worker version。
- 任何正式 repository change，包括程式碼、資料、設定、架構規則與正式資料變更，都增加網站 Patch version。
- 網站版本驗證要求 `package.json` 與 generated `public/data/version.json` 一致；Worker 只驗證自身版本格式，不與網站版本比較。

### Verification

- 不可只看 diff 判定完成。
- 依變更範圍執行適用的 TypeScript、Build、schema、data integrity、API、Worker 與 lifecycle verification。
- 涉及部署時必須確認 GitHub Actions；CI 通過仍不代表需要實際網站驗收的項目已完成。
- 發現驗證失敗時記錄根因與影響，修正後重新驗證。

## 11. TODO 管理

- `TODO.md` 只保存目前尚未完成、待驗證或需要後續處理的工作。
- 已完成的一次性工作立即移除，不寫成歷史紀錄。
- 會長期影響未來每次開發的規則才放入 `RULES.md`。
- TODO 不應複製 RULES；RULES 也不應充滿一次性 TODO。
- TODO 完成後若形成新的長期規則，才整理進 `RULES.md`。

## 12. 維護基線

- `data/` 是 canonical Item data。
- Store 是前端資料與 UI state 的主要來源。
- Remote mutation 仍須序列化；UI 可在請求送出後先套用 optimistic state，authoritative API response 完成後再回寫 Store，失敗則重新同步遠端狀態。
- 外部資料必須經 validation boundary。
- 共用互動採明確 lifecycle 或 delegation，不靠 MutationObserver、重複 listener 或 DOM patch workaround。
- Responsive contract 集中於共用 responsive layer。
- Modal／Detail 的 focus 與 keyboard accessibility 是正式 contract。
- R2 負責圖片 asset layer，GitHub metadata 負責 canonical metadata mutation。
- 正式變更遵守 Patch version 與 verification discipline。
