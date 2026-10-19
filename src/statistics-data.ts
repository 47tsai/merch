import type { Item, ShippingRecord } from './types';
import { categoryName } from './category-label';
import { currentYear, monthKey, monthLabel } from './utils/date';
import { formatMoney, formatPercent, formatQuantity } from './utils/format';

export type Row = { label: string; value: number };
export type DetailRow = { label: string; quantity: number; spend: number; share: number; extra?: string };
export type WorkItemDetail = { title: string; quantity: number; spend: number; unitPrice: number; currency: string; platform: string; date: string };
export type Chart = { id: string; title: string; description: string; largeType: 'bar' | 'donut'; smallType: 'bar' | 'donut'; rows: Row[]; details: DetailRow[]; format: 'money' | 'count'; summary: { label: string; value: string }[]; year?: number; workItemDetails?: Record<string, WorkItemDetail[]>; detailItems?: Record<string, WorkItemDetail[]> };
type WorkAggregate = { quantity: number; spend: number };

const quantity = (item: Item) => Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1;
const value = (item: Item) => Number(item.purchase?.price || 0) * quantity(item);
const shippingValue = (record: ShippingRecord) => Number(record.amount || 0);

export function statisticsYears(items: Item[], shipping: ShippingRecord[] = []): number[] {
  const years = new Set<number>([currentYear()]);
  items.forEach((item) => { const key = monthKey(item.purchase?.date); if (key) years.add(Number(key.slice(0, 4))); });
  shipping.forEach((record) => { const key = monthKey(record.date); if (key) years.add(Number(key.slice(0, 4))); });
  return [...years].filter(Number.isInteger).sort((a, b) => b - a);
}

export function aggregateStatistics(items: Item[], shipping: ShippingRecord[] = [], year = currentYear()): Chart[] {
  const workSpend = new Map<string, WorkAggregate>();
  const workCount = new Map<string, WorkAggregate>();
  const categoryCount = new Map<string, WorkAggregate>();
  const monthly = new Map<string, WorkAggregate>();
  const add = (map: Map<string, WorkAggregate>, key: string, row: WorkAggregate) => {
    const old = map.get(key) || { quantity: 0, spend: 0 };
    map.set(key, { quantity: old.quantity + row.quantity, spend: old.spend + row.spend });
  };
  items.forEach((item) => {
    const row = { quantity: quantity(item), spend: value(item) };
    add(workSpend, item.workName || '未分類作品', row);
    add(workCount, item.workName || '未分類作品', row);
    add(categoryCount, categoryName(item.category), row);
    const month = monthKey(item.purchase?.date);
    if (month) add(monthly, month, row);
  });
  shipping.forEach((record) => {
    const spend = shippingValue(record);
    if (!spend) return;
    const dateMonth = monthKey(record.date);
    if (dateMonth) add(monthly, dateMonth, { quantity: 0, spend });
  });
  const productSpend = [...workSpend.values()].reduce((sum, row) => sum + row.spend, 0);
  const shippingSpend = shipping.reduce((sum, record) => sum + shippingValue(record), 0);
  const totalSpend = productSpend + shippingSpend;
  const totalQuantity = items.reduce((sum, item) => sum + quantity(item), 0);
  const sortSpend = (map: Map<string, WorkAggregate>) => [...map.entries()].sort((a,b) => b[1].spend - a[1].spend || b[1].quantity - a[1].quantity || a[0].localeCompare(b[0], 'zh-Hant'));
  const sortQuantity = (map: Map<string, WorkAggregate>) => [...map.entries()].sort((a,b) => b[1].quantity - a[1].quantity || b[1].spend - a[1].spend || a[0].localeCompare(b[0], 'zh-Hant'));
  const details = (entries: [string, WorkAggregate][], denominator: number, extra?: (row: WorkAggregate) => string) => entries.map(([label, row]) => ({ label, quantity: row.quantity, spend: row.spend, share: denominator ? row.spend / denominator * 100 : 0, extra: extra?.(row) }));
  const rows = (entries: [string, WorkAggregate][], field: 'spend' | 'quantity'): Row[] => entries.map(([label, row]) => ({ label, value: field === 'spend' ? row.spend : row.quantity }));
  const workSpendEntries = sortSpend(workSpend);
  const workCountEntries = sortQuantity(workCount);
  const categoryEntries = sortQuantity(categoryCount);
  const categorySpendEntries = sortSpend(categoryCount);
  const workItemDetails: Record<string, WorkItemDetail[]> = {};
  items.forEach((item) => {
    const work = item.workName || '未分類作品';
    (workItemDetails[work] ||= []).push({ title: item.title, quantity: quantity(item), spend: value(item), unitPrice: Number(item.purchase?.price || 0), currency: item.purchase?.currency || 'TWD', platform: item.purchase?.platform || '未填寫', date: item.purchase?.date || '未填寫' });
  });
  Object.values(workItemDetails).forEach((list) => list.sort((a, b) => b.spend - a.spend || a.title.localeCompare(b.title, 'zh-Hant')));
  const toDetail = (item: Item): WorkItemDetail => ({ title: item.title, quantity: quantity(item), spend: value(item), unitPrice: Number(item.purchase?.price || 0), currency: item.purchase?.currency || 'TWD', platform: item.purchase?.platform || '未填寫', date: item.purchase?.date || '未填寫' });
  const monthlyDetailItems: Record<string, WorkItemDetail[]> = {};
  const categoryDetailItems: Record<string, WorkItemDetail[]> = {};
  items.forEach((item) => {
    const detail = toDetail(item);
    const month = monthKey(item.purchase?.date);
    if (month && Number(month.slice(0, 4)) === year) (monthlyDetailItems[month] ||= []).push(detail);
    const category = categoryName(item.category);
    (categoryDetailItems[category] ||= []).push(detail);
  });
  shipping.forEach((record) => {
    const month = monthKey(record.date);
    if (month && Number(month.slice(0, 4)) === year && Number(record.amount || 0)) (monthlyDetailItems[month] ||= []).push({ title: '運費', quantity: 1, spend: Number(record.amount || 0), unitPrice: Number(record.amount || 0), currency: record.currency || 'TWD', platform: record.carrier || '運費', date: record.date || '未填寫' });
  });
  const monthlyEntries: [string, WorkAggregate][] = Array.from({ length: 12 }, (_, i) => { const key = `${year}-${String(i + 1).padStart(2, '0')}`; return [key, monthly.get(key) || { quantity: 0, spend: 0 }]; });
  let cumulative = 0;
  const monthlyYearSpend = monthlyEntries.reduce((sum, [, row]) => sum + row.spend, 0);
  const monthlyDetails: DetailRow[] = monthlyEntries.map(([key, row], index) => { cumulative += row.spend; const previous = index ? monthlyEntries[index - 1][1].spend : 0; const delta = previous ? `${row.spend >= previous ? '+' : ''}${formatPercent((row.spend - previous) / previous * 100)} vs 上月` : '首筆月份'; return { label: monthLabel(key), quantity: row.quantity, spend: row.spend, share: monthlyYearSpend ? row.spend / monthlyYearSpend * 100 : 0, extra: `${formatMoney(cumulative)} 累計 · ${delta}` }; });
  const topWork = workSpendEntries[0];
  const topCategory = categorySpendEntries[0];
  const topMonth = monthlyEntries.reduce<[string, WorkAggregate] | undefined>((best, current) => !best || current[1].spend > best[1].spend ? current : best, undefined);
  const averageMonth = monthlyYearSpend / 12;
  return [
    { id: 'work-spending', title: '作品消費排行', description: '只計算作品本身的商品價格，不計入運費。', largeType: 'bar', smallType: 'donut', rows: rows(workSpendEntries, 'spend'), details: details(workSpendEntries, productSpend), format: 'money', workItemDetails, detailItems: workItemDetails, summary: [['總花費', formatMoney(totalSpend)], ['商品消費', formatMoney(productSpend)], ['運費', formatMoney(shippingSpend)], ['最高作品', topWork?.[0] || '無資料'], ['最高作品消費', topWork ? formatMoney(topWork[1].spend) : 'NT$ 0']].map(([label, value]) => ({ label, value })) },
    { id: 'monthly-spending', title: '每月消費趨勢', description: `商品消費與有日期的運費都會計入 ${year} 年 12 個月份。`, largeType: 'bar', smallType: 'bar', rows: monthlyEntries.map(([label, row]) => ({ label: monthLabel(label), value: row.spend })), details: monthlyDetails, format: 'money', year, detailItems: Object.fromEntries(monthlyEntries.map(([key]) => [monthLabel(key), monthlyDetailItems[key] || []])), summary: [['年度花費', formatMoney(monthlyYearSpend)], ['有消費月份', `${monthlyEntries.filter(([,r]) => r.spend > 0).length} 個月`], ['最高月份', topMonth ? monthLabel(topMonth[0]) : '無資料'], ['最高月消費', topMonth ? formatMoney(topMonth[1].spend) : 'NT$ 0'], ['月均花費', formatMoney(averageMonth)]].map(([label, value]) => ({ label, value })) },
    { id: 'work-count', title: '作品收藏數量', description: '看哪些作品收藏最多，數量依每筆資料的 quantity 加總。', largeType: 'bar', smallType: 'donut', rows: rows(workCountEntries, 'quantity'), details: details(workCountEntries, totalQuantity, (row) => `消費 ${formatMoney(row.spend)}`), format: 'count', detailItems: workItemDetails, summary: [['總收藏', formatQuantity(totalQuantity)], ['作品種類', `${workCountEntries.length} 個`], ['最多收藏作品', workCountEntries[0]?.[0] || '無資料'], ['最多作品數量', workCountEntries[0] ? formatQuantity(workCountEntries[0][1].quantity) : '0 件']].map(([label, value]) => ({ label, value })) },
    { id: 'category-spending', title: '各類型消費排行', description: '依周邊類型加總商品本身價格，不計運費。沒有實際支出的贈品仍會計入收藏數量，但消費金額為 0。', largeType: 'bar', smallType: 'bar', rows: rows(categorySpendEntries, 'spend'), details: details(categorySpendEntries, productSpend), format: 'money', detailItems: categoryDetailItems, summary: [['商品消費', formatMoney(productSpend)], ['類型數', `${categorySpendEntries.length} 類`], ['最高消費類型', topCategory?.[0] || '無資料'], ['最高類型消費', topCategory ? formatMoney(topCategory[1].spend) : 'NT$ 0']].map(([label, value]) => ({ label, value })) },
    { id: 'category-count', title: '類別收藏數量', description: '以周邊類型名稱呈現各類別收藏占比，詳細視圖提供完整數量與比例。', largeType: 'donut', smallType: 'donut', rows: rows(categoryEntries, 'quantity'), details: details(categoryEntries, totalQuantity, (row) => `消費 ${formatMoney(row.spend)}`), format: 'count', detailItems: categoryDetailItems, summary: [['總收藏', formatQuantity(totalQuantity)], ['類別數', `${categoryEntries.length} 類`], ['主要類別', categoryEntries[0]?.[0] || '無資料'], ['主要類別占比', categoryEntries[0] ? formatPercent(categoryEntries[0][1].quantity / Math.max(totalQuantity, 1) * 100) : '0%']].map(([label, value]) => ({ label, value })) },
  ];
}
