export type Tile = string;
const SUITS = "mpsz";
export const ALL_TILES: Tile[] = [...SUITS].flatMap((suit) =>
  Array.from(
    { length: suit === "z" ? 7 : 9 },
    (_, rank) => `${rank + 1}${suit}`,
  ),
);
export const PALETTE = [...ALL_TILES, "0m", "0p", "0s"];

/** Map red fives to their ordinary kind for all mathematical calculations. */
export function tileId(tile: Tile): number {
  return (
    SUITS.indexOf(tile[1]) * 9 + (tile[0] === "0" ? 5 : Number(tile[0])) - 1
  );
}

/** Parse Tenhou m/p/s/z notation; retain order and red fives, reject partial garbage. */
export function parseTiles(text: string): Tile[] {
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  if (!normalized) return [];
  if (!/^(?:[0-9]+[mpsz])+$/.test(normalized)) {
    throw new Error(
      "使用天凤牌串，例如 123m456p789s11223z；m 万、p 筒、s 索、z 字。",
    );
  }
  const result: Tile[] = [];
  for (const group of normalized.matchAll(/([0-9]+)([mpsz])/g)) {
    for (const rank of group[1]) {
      if (group[2] === "z" && (rank === "0" || Number(rank) > 7)) {
        throw new Error("字牌只能使用 1z–7z，依次为东南西北白发中。");
      }
      result.push(rank + group[2]);
    }
  }
  return result;
}

/** Encode consecutive suits without sorting, so corrections keep screenshot order. */
export function formatTiles(tiles: Tile[]): string {
  let output = "";
  let digits = "";
  let suit = "";
  for (const tile of tiles) {
    if (suit && tile[1] !== suit) {
      output += digits + suit;
      digits = "";
    }
    suit = tile[1];
    digits += tile[0];
  }
  return output + (digits ? digits + suit : "");
}

/** Count all physical copies; red and ordinary fives share the four-copy limit. */
export function countTiles(tiles: Tile[]): number[] {
  const counts = Array<number>(34).fill(0);
  for (const tile of tiles) counts[tileId(tile)]++;
  return counts;
}

/** Parse optional known melds. Whitespace separates chi/pon/kan groups. */
export function parseMelds(text: string): Tile[][] {
  if (!text.trim()) return [];
  return text
    .trim()
    .split(/\s+/)
    .map((group) => {
      const tiles = parseTiles(group);
      const ids = tiles.map(tileId).sort((a, b) => a - b);
      const same = ids.every((id) => id === ids[0]);
      const sequence =
        ids.length === 3 &&
        ids[0] < 27 &&
        Math.floor(ids[0] / 9) === Math.floor(ids[2] / 9) &&
        ids[1] === ids[0] + 1 &&
        ids[2] === ids[0] + 2;
      if (!((same && [3, 4].includes(ids.length)) || sequence)) {
        throw new Error(`「${group}」不是合法吃、碰或杠。各组请用空格分隔。`);
      }
      return tiles;
    });
}

/** Validate 3n+2 hands and the 3n+1 states reached after a simulated discard. */
export function validateHand(
  tiles: Tile[],
  melds: Tile[][] = [],
  discarded: Tile[] = [],
): void {
  if (tiles.length < 1 || tiles.length > 14 || tiles.length % 3 === 0) {
    throw new Error(
      "待切牌支持 2、5、8、11、14 张；待摸牌支持 1、4、7、10、13 张。",
    );
  }
  if (melds.length > 4 - Math.floor(tiles.length / 3)) {
    throw new Error("手牌与已填副露合计超过四组面子，请检查。");
  }
  const counts = countTiles([...tiles, ...melds.flat(), ...discarded]);
  const invalid = counts.findIndex((count) => count > 4);
  if (invalid !== -1)
    throw new Error(
      `${ALL_TILES[invalid]} 合计超过四张（红五与普通五合并计数）。`,
    );
}

/** Human-readable tile name, used by both buttons and screen readers. */
export function tileName(tile: Tile): string {
  if (tile[1] === "z")
    return ["东", "南", "西", "北", "白", "发", "中"][Number(tile[0]) - 1];
  return `${tile[0] === "0" ? "赤5" : tile[0]}${({ m: "万", p: "筒", s: "索" } as Record<string, string>)[tile[1]]}`;
}
