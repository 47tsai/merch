import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const validationSource = fs.readFileSync('src/validation.ts', 'utf8');
const apiSource = fs.readFileSync('src/api.ts', 'utf8');
const storeSource = fs.readFileSync('src/store.ts', 'utf8');
const errors = [];

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) errors.push(label);
}

for (const exportName of ['isRecord', 'isStringArray', 'isValidImage', 'isValidItem', 'isValidShipping']) {
  requirePattern(validationSource, new RegExp(`export function ${exportName}\\b`), `validation.ts 缺少 shared validator：${exportName}`);
}

requirePattern(apiSource, /import \{ isRecord, isStringArray, isValidImage, isValidItem, isValidShipping \} from '\.\/validation';/, 'api.ts 未從 validation.ts 匯入 shared validation boundary');
for (const name of ['isRecord', 'isValidImage', 'isValidItem', 'isValidShipping']) {
  if (apiSource.split(name).length - 1 < 2) errors.push(`api.ts 未實際使用 shared validator：${name}`);
}

requirePattern(storeSource, /import \{ isRecord, isStringArray, isValidImage, isValidShipping \} from '\.\/validation';/, 'store.ts 未從 validation.ts 匯入 Store 共用 validation primitive');
for (const name of ['isRecord', 'isStringArray', 'isValidImage', 'isValidShipping']) {
  if (storeSource.split(name).length - 1 < 2) errors.push(`store.ts 未實際使用 shared validator：${name}`);
}

for (const field of ['workName', 'shipping', 'material', 'release', 'createdAt', 'updatedAt']) {
  if (!storeSource.includes(`'${field}'`)) errors.push(`store.ts canonical validation 缺少 forbidden field contract：${field}`);
}
requirePattern(storeSource, /import \{ CATEGORY_CODES \} from '\.\/category-label';/, 'store.ts 必須從 category-label.ts 匯入唯一的 Category code registry，不得手寫第二份 Set');
requirePattern(storeSource, /parseItemId\(value\.id\)/, 'store.ts 缺少 Item ID canonical boundary');
requirePattern(storeSource, /parsed\.workCode !== work\.code/, 'store.ts 缺少 Work identity 精確比對');
requirePattern(storeSource, /normalizeQuantity\(value\.quantity, label\)/, 'store.ts 缺少 quantity canonical normalization');
requirePattern(storeSource, /if \(!isValidShipping\(value\)\)/, 'store.ts 未以 shared shipping validator 作為 canonical boundary');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merch-validation-contract-'));
try {
  const output = ts.transpileModule(validationSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: 'validation.ts'
  }).outputText;
  const modulePath = path.join(tempDir, 'validation.mjs');
  fs.writeFileSync(modulePath, output, 'utf8');
  const validation = await import(`${pathToFileURL(modulePath).href}?contract=${Date.now()}`);

  const validImage = { id: 'img-1', file: 'cover.webp', alt: 'cover' };
  const validShipping = { id: 'ship-1', amount: 100, currency: 'TWD', itemIds: ['AB-001'] };
  const validItem = {
    id: 'AB-001', workId: 'work-1', workName: 'Test', title: 'Item', series: [], characters: [],
    category: 'b', manufacturer: 'Maker', quantity: 1, status: 'received', description: '', notes: '',
    purchase: {}, arrival: {}, afterSales: {}, images: [validImage]
  };

  const cases = [
    [validation.isValidImage(validImage), true, 'valid image 應通過'],
    [validation.isValidImage({ ...validImage, id: '' }), false, '空 image.id 應拒絕'],
    [validation.isValidImage({ ...validImage, file: '' }), false, '空 image.file 應拒絕'],
    [validation.isValidImage({ ...validImage, isCover: 'yes' }), false, '錯誤 image.isCover 型別應拒絕'],
    [validation.isValidShipping(validShipping), true, 'valid shipping 應通過'],
    [validation.isValidShipping({ ...validShipping, amount: -1 }), false, '負 shipping amount 應拒絕'],
    [validation.isValidShipping({ ...validShipping, itemIds: [] }), false, '空 shipping.itemIds 應拒絕'],
    [validation.isValidShipping({ ...validShipping, itemIds: [''] }), false, '空 shipping itemId 應拒絕'],
    [validation.isValidItem(validItem), true, 'valid enriched item 應通過'],
    [validation.isValidItem({ ...validItem, quantity: 0 }), false, 'quantity 0 應拒絕'],
    [validation.isValidItem({ ...validItem, quantity: 1.5 }), false, '非整數 quantity 應拒絕'],
    [validation.isValidItem({ ...validItem, images: [validImage, validImage] }), false, '重複 image.id 應拒絕'],
    [validation.isValidItem({ ...validItem, purchase: { price: -1 } }), false, '負 purchase.price 應拒絕'],
    [validation.isValidItem({ ...validItem, arrival: { expectedDate: 123 } }), false, '錯誤 arrival date 型別應拒絕'],
    [validation.isValidItem({ ...validItem, afterSales: { note: 123 } }), false, '錯誤 afterSales.note 型別應拒絕']
  ];
  for (const [actual, expected, label] of cases) if (actual !== expected) errors.push(`runtime validation contract 失敗：${label}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (errors.length) {
  console.error('Validation boundary contract verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Validation boundary contract verification passed.');
