import fs from 'node:fs';
import { strict as assert } from 'node:assert';

const read = (path) => fs.readFileSync(path, 'utf8');
const works = JSON.parse(read('data/works.json'));
assert.equal(works.schemaVersion, 2, 'works.json 必須使用 schemaVersion 2');
assert.ok(Array.isArray(works.works) && works.works.length > 0, 'works.json 必須至少有一個作品');

const ids = new Set();
const codes = new Set();
for (const work of works.works) {
  assert.ok(work && typeof work === 'object', 'Work 必須是 object');
  assert.ok(typeof work.id === 'string' && work.id, 'Work ID 不得為空');
  assert.ok(typeof work.name === 'string' && work.name, `Work name 無效：${work.id}`);
  assert.ok(/^[A-Z]{2,3}$/.test(work.code), `Work code 無效：${work.id}`);
  assert.ok(typeof work.path === 'string' && work.path.startsWith('data/'), `Work path 無效：${work.id}`);
  assert.ok(!ids.has(work.id), `Work ID 重複：${work.id}`);
  assert.ok(!codes.has(work.code), `Work code 重複：${work.code}`);
  ids.add(work.id);
  codes.add(work.code);
}

const main = read('src/main.ts');
const add = read('src/add.ts');
const management = read('src/management.ts');
const statistics = read('src/statistics-data.ts');
const collection = read('src/main.ts');
const generator = read('scripts/generate-collection.mjs');

const homeEnhancements = read('src/home-enhancements.ts');
assert.match(homeEnhancements, /return store\.snapshot\.works\s*\.map\(\(work\) =>/, '首頁作品排行必須由 Store works registry 動態產生');
assert.match(main, /set\('total'/, '首頁摘要必須由 Store 計算持有件數');
assert.match(main, /set\('spending'/, '首頁摘要必須由 Store 計算累計支出');
assert.match(collection, /snapshot\.works\.find\(\(w\) => w\.id === ui\.collectionWork\)/, 'Collection 作品篩選必須依 Work ID 查詢 Store registry');
assert.match(add, /store\.snapshot\.works\.map\(work =>/, '新增頁作品選單必須由 Store works 動態產生');
assert.match(management, /snapshot\.works/, '管理頁必須使用 Store works registry');
assert.match(statistics, /item\.workName/, 'Statistics 必須由 Item 的 Work identity 動態聚合');
assert.match(generator, /for \(const work of worksIndex\.works\)/, 'Collection read model 必須遍歷 works registry');

for (const code of codes) {
  assert.ok(!new RegExp(`['\"]${code}['\"]`).test(statistics), `Statistics 不應硬編碼 Work code：${code}`);
}

console.log(`Work registry contract passed for ${works.works.length} works.`);
