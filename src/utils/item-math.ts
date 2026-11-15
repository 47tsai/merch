import type { Item } from '../types';

/**
 * Single source of truth for per-Item quantity / value math.
 * Previously `quantityOf` / `itemValue` were copy-pasted in main.ts,
 * home-enhancements.ts and statistics-data.ts (as `quantity` / `value`),
 * so one rule change had to be applied in four places.
 * `quantity` missing or invalid defaults to 1; a malformed value must
 * never be silently treated as 1 by the Store (see store.ts).
 */
export function quantityOf(item: Item): number {
  return Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1;
}

export function itemValue(item: Item): number {
  return Number(item.purchase?.price || 0) * quantityOf(item);
}
