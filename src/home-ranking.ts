import type { Item } from './types';
import { itemValue, quantityOf } from './utils/item-math';

export type CharacterRankingRow = [character: string, spending: number];

export function rankAt(rows: CharacterRankingRow[], index: number): number {
  if (index === 0) return 1;
  return rows[index][1] === rows[index - 1][1] ? rankAt(rows, index - 1) : index + 1;
}

export function sortCharacterRanking(rows: CharacterRankingRow[]): CharacterRankingRow[] {
  return [...rows].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'));
}

export function rankValueAt(values: number[], index: number): number {
  if (index === 0) return 1;
  return values[index] === values[index - 1] ? rankValueAt(values, index - 1) : index + 1;
}

/** Unique, trimmed character names for one Item, in first-seen order. */
export function itemCharacters(item: Item): string[] {
  return [...new Set((item.characters || []).map((character) => String(character).trim()).filter(Boolean))];
}

/**
 * Character spending ranking. One Item's value is split equally across its
 * characters, so the amounts add up to the Item's value exactly once.
 * Previously this lived in home-enhancements.ts next to the count logic,
 * which counts the full quantity for every character instead — the two
 * numbers on one ranking line ("5 件 NT$2,227") were computed on
 * different bases. They still are, by design, but now both rules live
 * in one place and the UI must say so (see index.html).
 */
export function aggregateCharacterSpending(items: Item[]): CharacterRankingRow[] {
  const spendingByCharacter = new Map<string, number>();
  items.forEach((item) => {
    const characters = itemCharacters(item);
    if (!characters.length) return;
    const share = itemValue(item) / characters.length;
    characters.forEach((character) => spendingByCharacter.set(character, (spendingByCharacter.get(character) || 0) + share));
  });
  return sortCharacterRanking([...spendingByCharacter.entries()]);
}

/**
 * Character item counts. Unlike spending, a multi-character Item counts
 * its full quantity for every character — the counts across characters
 * therefore add up to more than the collection total. Displayed together
 * with spending only with the explanatory note in index.html.
 */
export function characterItemCounts(items: Item[]): Map<string, number> {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    itemCharacters(item).forEach((character) => counts.set(character, (counts.get(character) || 0) + quantityOf(item)));
  });
  return counts;
}
