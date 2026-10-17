# Merch Project Architecture

> 本文件描述目前 repository 的責任邊界與資料流。`RULES.md` 是長期開發規則；`TODO.md` 是未完成工作；本文件只描述「現在怎麼組成」。

## 1. Repository map

```text
merch/
├── .github/workflows/       CI / deployment
├── data/                    canonical data
├── public/                  static assets + generated read model
├── scripts/                 build / sync / verification
├── src/                     frontend TypeScript / CSS
├── worker/src/              API / GitHub mutation / R2 boundary
├── worker/wrangler.toml     Cloudflare Worker deployment config
├── index.html               SPA shell
├── package.json             project metadata / scripts / version
├── tsconfig.json            TypeScript config
├── vite.config.ts           Vite config
├── CNAME                    production domain
├── RULES.md                 long-term development rules
├── TODO.md                  unfinished work
├── ITEM_SCHEMA.md           Item data contract
├── ITEM_TYPES.md            category registry
├── UI_ARCHITECTURE.md       UI responsibility baseline
└── PROJECT_ARCHITECTURE.md  repository responsibility baseline
```

## 2. Data flow

```text
canonical repository
      │
      ▼
    data/
      │
      ├── works.json
      └── <work>/<category>/<item>/data.json + images/
      │
      ▼ build
public/data/
      │
      └── collection / version / deploy read models
      │
      ▼
Frontend Store
      │
      ├── Page rendering
      └── API mutations
              │
              ▼
       Cloudflare Worker
          │          │
          ▼          ▼
       GitHub       R2
      metadata     image binary
```

### Authority

1. `data/`：canonical Item / Work data。
2. `src/store.ts`：前端資料與 UI state 的主要來源。
3. Worker：GitHub remote mutation boundary。
4. R2：圖片 binary asset layer。
5. `public/data/`：build 產生的部署 read model，不是新的 canonical write target。

## 3. Canonical data layout

```text
data/
├── works.json
└── <work-id>/
    └── <category>/
        ├── index.json
        └── <item-id>/
            ├── data.json
            └── images/
```

- Work 使用永久 `work.id`。
- Item 是獨立資料單位。
- Item ID 建立後保持穩定。
- category index 只提供索引與列表所需資料。
- `data.json` 才是 Item 詳細資料的 canonical source。
- 圖片 metadata 存於 Item data；正式圖片 binary 由 R2 提供。
- 新增 Item 不應無故修改 `data/works.json`。
- `public/data/collection.json` 等 generated data 由 build 產生，不手動新增 Item。

## 4. Frontend layers

### Application core

| 模組 | 責任 |
|---|---|
| `src/main.ts` | App 啟動、頁面初始化與 rendering 協調 |
| `src/router.ts` | Hash route parsing、navigation、404 |
| `src/store.ts` | remote data、UI state、remote apply |
| `src/api.ts` | API request、response validation、mutation |
| `src/error.ts` | error normalization |

### Identity / navigation / asset helpers

| 模組 | 責任 |
|---|---|
| `src/item-id.ts` | Item ID parse / compose / validation |
| `src/category-label.ts` | category code → visible label |
| `src/cross-navigation.ts` | 跨頁 query / filter navigation |
| `src/image-source.ts` | Item image / R2 URL / fallback |

### Page modules

| 模組 | 責任 |
|---|---|
| `src/add.ts` | 新增 Item |
| `src/collection-controls.ts` | Collection search / filter / sort / view |
| `src/management.ts` | Work / Item CRUD |
| `src/shipping.ts` | Shipping page / shipping operations |
| `src/statistics.ts` | Statistics rendering / charts |
| `src/statistics-data.ts` | Statistics calculation / data shaping |
| `src/settings-auth.ts` | Settings authentication |
| `src/home-ranking.ts` | Home ranking |
| `src/home-enhancements.ts` | Home-specific enhancement |
| `src/item-detail-shipping.ts` | Item Detail arrival / shipping-related logic |
| `src/shipping-detail-modal.ts` | Shipping detail modal |
| `src/detail-focus.ts` | Detail / dialog focus lifecycle |

頁面模組可以組合共用 foundation，但不得成為第二個 Store 或第二套共用元件系統。

## 5. Shared UI layer

```text
src/main.ts
   ├── shared base styles
   └── src/merch.css (loaded last)
          ├── MERCH visual system
          ├── semantic token aliases
          └── responsive layout / mobile bottom navigation
```

其他 shared systems：

- `src/app-loading.*`：初始載入狀態。
- `src/sync-overlay.*`：blocking remote mutation 狀態。
- `src/page-auth-status.*`：頁面驗證狀態。
- `src/utils/toast.ts`：舊 Toast API 的 compatibility forwarding，不建立第二套視覺層。
- `src/image-viewer.*`：圖片 viewer。

正式首頁 `index.html` 是唯一前端入口。`src/main.ts` 載入共用樣式後，最後載入 `src/merch.css` 作為正式 UI 視覺與 responsive 規則。舊的 preview entry 與重複 refinement stylesheet 已移除。

## 6. Worker boundary

```text
worker/src/
├── index.ts       GitHub API read/write + mutation boundary
├── r2-entry.ts    /api/assets R2 request boundary + GitHub mirror
├── r2-assets.ts   R2 helpers
└── validation.ts  Worker input / schema validation
```

一般 API mutation：

```text
Frontend → api.ts → Worker → GitHub → response → Store remote-apply → UI
```

圖片 mutation：

```text
Frontend
  → /api/assets/*
  → validate
  → R2 write + verification
  → GitHub metadata mutation
  → rollback R2 on GitHub failure
  → response
```

R2 不取代 canonical metadata；GitHub metadata 與 R2 binary 必須有明確的一致性策略。

## 7. Build / deployment

```text
push main
  │
  ├── Verify workflow
  │     ├── data / schema / category / image
  │     ├── API / Worker contracts
  │     ├── architecture / lifecycle checks
  │     └── TypeScript / build checks
  │
  └── Deploy workflow
        ├── Vite → GitHub Pages
        └── Wrangler → Cloudflare Worker
```

`npm run build` 的主要順序：

1. `sync-public-data.mjs`
2. `generate-collection.mjs`
3. `tsc --noEmit`
4. `vite build`

Repository 不提交 `package-lock.json`；CI / deployment 使用 `npm install --no-package-lock`。

## 8. Scripts

Scripts 分成四類：

- **Build / sync**：同步 canonical data、產生 deployment read model。
- **Data / schema**：資料 layout、schema、category、legacy field、image、statistics、management 驗證。
- **API / Worker**：load、mutation、scope、image、transaction、validation 等 contract 驗證。
- **CI contract**：確認 scripts 與 workflow 的 wiring 一致。

已完成且沒有現行責任的 migration / reset / equivalence script 不應保留。

## 9. Responsibility boundary

| 問題 | 應由哪一層負責 |
|---|---|
| canonical Item data | `data/` |
| 前端 state | `src/store.ts` |
| route | `src/router.ts` |
| API request / validation | `src/api.ts` |
| remote GitHub mutation | Worker |
| image binary | R2 |
| generated collection | build scripts |
| shared visual foundation | `src/main.ts` 與 `src/merch.css` / theme styles |
| 未完成工作 | `TODO.md` |
| 長期規則 | `RULES.md` |
| Item schema | `ITEM_SCHEMA.md` |
| category registry | `ITEM_TYPES.md` |

同一責任若在多層重複出現，應先確認實際資料流與 import / selector 邊界，再合併或移除，不以額外 patch 疊加。
