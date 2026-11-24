// Worker 錯誤碼 → 使用者看得到的繁體中文文案，對照表。
//
// 唯一真相來源：worker/src/index.ts 的 fail() 與 worker/src/r2-entry.ts 的
// errorResponse() 實際使用的 code（含 fetch catch 轉成的 GITHUB_API_ERROR／
// INTERNAL_ERROR）。scripts/verify-error-codes.mjs 雙向檢查：Worker 全部
// code 都要在表裡、表裡不能有 Worker 沒在用的孤兒 code。Worker 新增或
// 刪除 code 時，這張表要同步改，否則 verify 會擋。
export const ERROR_MESSAGES = {
  ASSET_AMBIGUOUS: '圖片檔名不唯一，請用完整路徑重新指定圖片。',
  ASSET_INVALID: '圖片資料格式無效，請重新上傳圖片。',
  ASSET_NOT_FOUND: '找不到圖片，請重新整理後再試。',
  AUTH_NOT_CONFIGURED: '管理驗證尚未完成設定，請稍後再試。',
  CATEGORY_NOT_FOUND: '找不到圖片所屬的類型，請重新整理後再試。',
  GITHUB_API_ERROR: 'GitHub 連線失敗，請稍後再試。',
  GITHUB_DELETE_FAILED: '圖片刪除失敗，舊圖片已還原，請再試一次。',
  GITHUB_DELETE_FAILED_ROLLBACK_FAILED: '圖片刪除失敗，且舊圖片還原也失敗，請檢查圖片狀態。',
  GITHUB_DELETE_RESPONSE_FAILED_ROLLBACK_FAILED: '圖片刪除失敗，且舊圖片還原也失敗，請檢查圖片狀態。',
  GITHUB_MUTATION_FAILED: '圖片寫入失敗，舊圖片已還原，請再試一次。',
  GITHUB_MUTATION_FAILED_ROLLBACK_FAILED: '圖片寫入失敗，且舊圖片還原也失敗，請檢查圖片狀態。',
  GITHUB_RESPONSE_FAILED_ROLLBACK_FAILED: '圖片寫入失敗，且舊圖片還原也失敗，請檢查圖片狀態。',
  ID_MISMATCH: '請求的編號與內容不一致，請重新整理後再試。',
  INTERNAL_ERROR: '伺服器處理失敗，請稍後再試。',
  INVALID_ASSET_PATH: '圖片路徑格式無效，請重新選擇圖片。',
  ITEM_IN_USE: '這個收藏仍被運費紀錄關聯，請先移除運費關聯後再刪除。',
  ITEM_MOVE_CONFLICT: '目標位置已有同名圖片，移動已取消。',
  ITEM_PATH_MISMATCH: '圖片路徑與收藏位置不一致，請重新整理後再試。',
  NOT_FOUND: '找不到請求的資料，請重新整理後再試。',
  ORIGIN_NOT_ALLOWED: '來源網域不被允許，請從收藏站網址開啟。',
  R2_MIRROR_DELETE_FAILED: '圖片刪除失敗，尚未刪除任何資料，請再試一次。',
  R2_MIRROR_FAILED: '圖片儲存失敗，尚未寫入任何資料，請再試一次。',
  R2_PREVIOUS_READ_FAILED: '無法讀取既有圖片，尚未寫入任何資料，請再試一次。',
  SHIPPING_NOT_FOUND: '找不到這筆運費紀錄，請重新整理後再試。',
  TREE_TRUNCATED: '資料量過大，暫時無法讀取，請稍後再試。',
  UNAUTHORIZED: '需要管理員驗證，請重新驗證後再試。',
  WORK_CHANGE: '既有收藏不允許更換作品，請重新整理後再試。',
  WORK_CODE_EXISTS: '作品代碼已存在，請換一個代碼。',
  WORK_CODE_LOCKED: '作品已有收藏，不可修改作品代碼。',
  WORK_EXISTS: '作品 ID 已存在，請換一個 ID。',
  WORK_NOT_EMPTY: '作品仍有收藏，請先移除所有收藏後再刪除。',
  WORK_NOT_FOUND: '找不到作品，請重新整理後再試。',
} as const;

export type WorkerErrorCode = keyof typeof ERROR_MESSAGES;

/** 查不到就回 undefined，呼叫端再 fallback 用 Worker 回的 message。 */
export function errorMessageForCode(code: string): string | undefined {
  return (ERROR_MESSAGES as Record<string, string>)[code];
}
