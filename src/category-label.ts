export const CATEGORY_OPTIONS = [
  ['b', '徽章／吧唧'], ['c', '卡片'], ['d', '立牌／擺件'], ['e', '電子產品'], ['f', '手辦／模型'],
  ['g', '文具'], ['h', '海報／掛畫／掛軸'], ['k', '掛件／吊飾'], ['l', '文件／資料夾'], ['m', '書籍／漫畫'],
  ['n', '明信片'], ['o', '其他'], ['p', '毛絨／布偶'], ['q', '鑰匙圈'], ['r', '雷射票'], ['s', '色紙'],
  ['t', '貼紙'], ['v', '服飾'], ['w', '餐具／生活用品'], ['y', '特典'],
] as const;

export const CATEGORY_CODES: Set<string> = new Set(CATEGORY_OPTIONS.map(([code]) => code));
const CATEGORY_NAMES: Record<string, string> = Object.fromEntries(CATEGORY_OPTIONS);

export function categoryName(code: string | undefined | null): string {
  if (!code) return '未分類';
  return CATEGORY_NAMES[code] ?? code;
}
