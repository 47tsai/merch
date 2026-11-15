#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dataRoot = path.resolve(root, process.argv[2] || 'data');
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(dataRoot, relativePath), 'utf8'));
const fail = (message) => { throw new Error(message); };
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const categoryCode = /^[a-z]$/;
const itemId = /^([A-Z]{2,3})([a-z])(\d{3})$/;

const categoryData = JSON.parse(await fs.readFile(path.join(root, 'public/data/categories.json'), 'utf8'));
if (!record(categoryData) || !Array.isArray(categoryData.categories)) fail('categories.json 格式無效。');

// src/category-label.ts is the single source of the category registry in code;
// categories.json must not drift from it (a code present in one and missing in
// the other used to be silently filtered out by the Store fallback load).
const labelSource = await fs.readFile(path.join(root, 'src/category-label.ts'), 'utf8');
const labelOptions = new Map();
for (const [, code, name] of labelSource.matchAll(/\['([a-z])', '([^']+)'\]/g)) labelOptions.set(code, name);
if (labelOptions.size !== 20) fail(`category-label.ts 應有 20 個類型，目前解析到 ${labelOptions.size} 個。`);
const codes = new Set();
const names = new Set();
for (const category of categoryData.categories) {
  if (!record(category) || !categoryCode.test(String(category.code)) || typeof category.name !== 'string' || !category.name.trim() || !Array.isArray(category.aliases)) fail('categories.json 存在無效類型。');
  if (codes.has(category.code)) fail(`重複 category code：${category.code}`);
  if (names.has(category.name)) fail(`重複 category name：${category.name}`);
  codes.add(category.code);
  names.add(category.name);
  if (!labelOptions.has(category.code)) fail(`categories.json 有、但 category-label.ts 沒有的類型：${category.code}`);
  if (labelOptions.get(category.code) !== category.name) fail(`類型名稱不一致：${category.code} 在 categories.json 是「${category.name}」，在 category-label.ts 是「${labelOptions.get(category.code)}」`);
  for (const alias of category.aliases) if (typeof alias !== 'string' || !alias.trim()) fail(`無效 category alias：${category.code}`);
  if (category.name.includes('亞克力') || category.aliases.some(alias => alias === '亞克力')) fail('「亞克力」是材質，不得作為商品類型。');
}

const works = await readJson('works.json');
if (!record(works) || works.schemaVersion !== 2 || !Array.isArray(works.works)) fail('works.json 格式無效。');
let checked = 0;
for (const work of works.works) {
  if (!record(work) || typeof work.id !== 'string') fail('作品索引格式無效。');
  const workDir = path.join(dataRoot, work.id);
  let categories = [];
  try { categories = (await fs.readdir(workDir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { continue; }
  for (const category of categories) {
    if (!codes.has(category)) fail(`Item storage 使用未註冊類型：${work.id}/${category}`);
    const index = await readJson(`${work.id}/${category}/index.json`);
    if (!record(index) || index.schemaVersion !== 1 || index.workId !== work.id || index.category !== category || !Array.isArray(index.items)) fail(`Category index 格式無效：${work.id}/${category}`);
    for (const entry of index.items) {
      if (!record(entry) || typeof entry.id !== 'string' || !itemId.test(entry.id)) fail(`Item ID 無效：${work.id}/${category}`);
      const relative = `${work.id}/${category}/${entry.id}/data.json`;
      const item = await readJson(relative);
      if (!record(item) || item.id !== entry.id || item.workId !== work.id || item.category !== category) fail(`Item category identity 不一致：${entry.id}`);
      if (item.category === '亞克力' || item.category === 'acrylic') fail(`Item 不得以材質作為 category：${entry.id}`);
      checked += 1;
    }
  }
}

for (const code of labelOptions.keys()) if (!codes.has(code)) fail(`category-label.ts 有、但 categories.json 沒有的類型：${code}`);

console.log(`Category contract verification passed: ${codes.size} categories, ${checked} Items.`);
