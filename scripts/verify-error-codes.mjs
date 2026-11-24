import fs from 'node:fs';

const fail = (condition, message) => {
  if (!condition) throw new Error(`Error-code verification failed: ${message}`);
};

// Worker 實際回的 code：index.ts 的 fail() 與 r2-entry.ts 的 errorResponse()。
// 含 fetch catch 轉成的 GITHUB_API_ERROR／INTERNAL_ERROR（它們本身就是 fail() 的 code）。
const indexSource = fs.readFileSync('worker/src/index.ts', 'utf8');
const r2Source = fs.readFileSync('worker/src/r2-entry.ts', 'utf8');
const tableSource = fs.readFileSync('src/error-codes.ts', 'utf8');
const apiSource = fs.readFileSync('src/api.ts', 'utf8');

const workerCodes = new Set([
  ...[...indexSource.matchAll(/fail\('([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]),
  ...[...r2Source.matchAll(/errorResponse\('([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]),
]);

// 對照表每行一個 code：`  CODE: '繁體中文文案',`
const tableMatches = [...tableSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*'([^']+)'/gm)];
const tableCodes = new Set(tableMatches.map((m) => m[1]));
fail(tableMatches.length > 0, 'src/error-codes.ts: no error-code entries found');
fail(
  tableMatches.length === tableCodes.size,
  `src/error-codes.ts: duplicate error-code entries (found ${tableMatches.length} lines, ${tableCodes.size} unique codes)`,
);
for (const [, code, message] of tableMatches) {
  fail(message.trim().length > 0, `src/error-codes.ts: empty message for ${code}`);
}

// 雙向檢查：Worker 全部 code 都要在表裡、表裡不能有 Worker 沒在用的孤兒 code。
const missing = [...workerCodes].filter((code) => !tableCodes.has(code));
fail(missing.length === 0, `codes used by the Worker but missing from src/error-codes.ts: ${missing.join(', ')}`);
const orphans = [...tableCodes].filter((code) => !workerCodes.has(code));
fail(orphans.length === 0, `codes in src/error-codes.ts but never used by the Worker: ${orphans.join(', ')}`);

// api.ts 的 request() 錯誤路徑必須真的查表，而不是只留一張沒人用的表。
fail(apiSource.includes("from './error-codes'"), 'src/api.ts: must import the error-code table');
fail(
  apiSource.includes('errorMessageForCode(failure.apiCode)'),
  'src/api.ts: request() error path must look up the table by the Worker error code',
);

console.log(
  `Error-code verification passed: ${workerCodes.size} Worker codes covered by src/error-codes.ts, no orphans, and api.ts looks the table up.`,
);
