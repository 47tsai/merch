import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Real arithmetic for the pure calculation modules, bundled the same way
// scripts/verify-worker-runtime.test.mjs bundles the Worker. These tests
// exist because the 28 verify:* scripts only check contracts and formats,
// never arithmetic — the 879.7% statistics bug shipped for exactly that reason.
const bundleOne = async (entryPoint) => (await build({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  write: false,
})).outputFiles[0];

const load = async (outputFile) => {
  const url = `data:text/javascript;base64,${Buffer.from(outputFile.text).toString('base64')}`;
  return import(url);
};

const { aggregateStatistics } = await load(await bundleOne('src/statistics-data.ts'));
const { aggregateCharacterSpending, characterItemCounts, rankAt, sortCharacterRanking } = await load(await bundleOne('src/home-ranking.ts'));

const item = (overrides) => ({
  id: 'HSRb001', workId: 'hsr', workName: '崩壞：星穹鐵道', title: '測試', series: [],
  characters: [], category: 'b', manufacturer: '', quantity: 1, status: 'received',
  description: '', notes: '', purchase: {}, arrival: {}, afterSales: {}, images: [],
  ...overrides,
});

// Fixture mirrors the live collection's shape: 47 badges (one Item with
// quantity 47) and the single 1/8 figure, 流螢 春日手信, NT$1,302.
const fixture = [
  item({ id: 'HSRb001', title: '吧唧合集', category: 'b', quantity: 47, purchase: { price: 86, date: '2026-08-05' } }),
  item({ id: 'HSRf001', title: '流螢 春日手信 1/8比例手辦', category: 'f', characters: ['流螢'], quantity: 1, purchase: { price: 1302, date: '2026-08-05' } }),
];

const chart = (charts, id) => charts.find((entry) => entry.id === id);
const sumShares = (details) => details.reduce((sum, row) => sum + row.share, 0);

test('count charts divide quantities by total quantity, not spend', () => {
  const charts = aggregateStatistics(fixture, [], 2026);
  const categoryCount = chart(charts, 'category-count');
  const figure = categoryCount.details.find((row) => row.label === '手辦／模型');
  assert.ok(figure, 'figure row must exist');
  // 1 piece out of 48 — the old formula gave 1302 / 48 * 100 = 2712.5%.
  assert.ok(Math.abs(figure.share - (1 / 48 * 100)) < 1e-9, `figure count share must be 2.0833%, got ${figure.share}`);
  assert.ok(figure.share < 100, 'a count share can never exceed 100%');
  assert.ok(Math.abs(sumShares(categoryCount.details) - 100) < 1e-9, 'count detail shares must add up to 100%');
  const workCount = chart(charts, 'work-count');
  assert.ok(Math.abs(sumShares(workCount.details) - 100) < 1e-9, 'work count detail shares must add up to 100%');
});

test('money charts still divide spend by total spend', () => {
  const charts = aggregateStatistics(fixture, [], 2026);
  const categorySpending = chart(charts, 'category-spending');
  const figure = categorySpending.details.find((row) => row.label === '手辦／模型');
  assert.ok(Math.abs(figure.share - (1302 / 5344 * 100)) < 1e-9, `figure money share must be 24.37%, got ${figure.share}`);
  assert.ok(Math.abs(sumShares(categorySpending.details) - 100) < 1e-9, 'money detail shares must add up to 100%');
  const workSpending = chart(charts, 'work-spending');
  assert.ok(Math.abs(sumShares(workSpending.details) - 100) < 1e-9, 'work money detail shares must add up to 100%');
});

test('character spending splits multi-character Items equally; counts do not split', () => {
  const items = [
    item({ id: 'HSRb002', title: '雙人吧唧', category: 'b', characters: ['流螢', '銀狼'], quantity: 1, purchase: { price: 1000, date: '2026-08-05' } }),
    item({ id: 'HSRf001', title: '流螢 春日手信 1/8比例手辦', category: 'f', characters: ['流螢'], quantity: 1, purchase: { price: 1302, date: '2026-08-05' } }),
    item({ id: 'HSRb003', title: '銀狼吧唧', category: 'b', characters: ['銀狼'], quantity: 3, purchase: { price: 100, date: '2026-08-05' } }),
  ];
  const rows = aggregateCharacterSpending(items);
  assert.deepEqual(rows, [['流螢', 1802], ['銀狼', 800]]);
  assert.equal(rows.reduce((sum, [, spend]) => sum + spend, 0), 2602, 'split spending must add up to the Items value exactly once');
  const counts = characterItemCounts(items);
  assert.equal(counts.get('流螢'), 2, '流螢 count: 1 + 1');
  assert.equal(counts.get('銀狼'), 4, '銀狼 count: 1 + 3, full quantity per character');
});

test('character ranking ties share a rank', () => {
  const rows = sortCharacterRanking([['乙', 200], ['甲', 500], ['丙', 500]]);
  assert.deepEqual(rows.map(([name]) => name), ['丙', '甲', '乙']);
  assert.deepEqual(rows.map((_, index) => rankAt(rows, index)), [1, 1, 3]);
});
