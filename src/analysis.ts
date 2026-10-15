import { ALL_TILES, countTiles, tileId, validateHand } from "./tiles.ts";
import type { Tile } from "./tiles.ts";

export type Wait = { tile: Tile; remaining: number };
export type Row = {
  discard: Tile | null;
  shanten: number;
  waits: Wait[];
  total: number;
};
export type Analysis = {
  shanten: number;
  rows: Row[];
  mode: "discard" | "draw";
};
type Engine = { analyze: (...args: number[]) => bigint };
const MASK = (1n << 34n) - 1n;

/** Encode 34 counts into four base-five integers for a pure scalar WASM interface. */
function pack(counts: number[]): number[] {
  return [0, 9, 18, 27].map((offset) =>
    counts
      .slice(offset, offset + (offset === 27 ? 7 : 9))
      .reduce((encoded, count, rank) => encoded + count * 5 ** rank, 0),
  );
}

/** Load the bundled MIT shanten-dp engine; no calculation requests leave the device. */
export async function loadEngine(bytes: BufferSource): Promise<Engine> {
  const result = await WebAssembly.instantiate(bytes);
  return result.instance.exports as unknown as Engine;
}

/** Calculate one draw state, using limits that exclude all supplied known tiles. */
function calculate(
  engine: Engine,
  counts: number[],
  limits: number[],
  m: number,
): Omit<Row, "discard"> {
  const result = engine.analyze(...pack(counts), ...pack(limits), m);
  if (result === -2n) throw new Error("计算参数不合法。");
  if (result === -1n) return { shanten: Infinity, waits: [], total: 0 };
  const shanten = Number(result >> 34n) - 1;
  const mask = result & MASK;
  const waits = ALL_TILES.flatMap((tile, id) => {
    const remaining = limits[id] - counts[id];
    return remaining > 0 && (mask & (1n << BigInt(id))) !== 0n
      ? [{ tile, remaining }]
      : [];
  });
  return {
    shanten,
    waits,
    total: waits.reduce((sum, wait) => sum + wait.remaining, 0),
  };
}

/** Enumerate every discard. A discarded tile remains known and cannot re-enter the pool. */
export function analyzeHand(
  engine: Engine,
  tiles: Tile[],
  melds: Tile[][] = [],
  discarded: Tile[] = [],
): Analysis {
  validateHand(tiles, melds, discarded);
  const counts = countTiles(tiles);
  const known = countTiles([...melds.flat(), ...discarded]);
  const limits = known.map((count) => 4 - count);
  const m = Math.floor(tiles.length / 3);
  const current = calculate(engine, counts, limits, m);
  if (tiles.length % 3 === 1) {
    return {
      shanten: current.shanten,
      mode: "draw",
      rows: [{ discard: null, ...current }],
    };
  }
  if (current.shanten === -1) return { shanten: -1, mode: "discard", rows: [] };
  const rows = [...new Set(tiles)]
    .map((discard) => {
      const id = tileId(discard);
      const next = [...counts];
      const nextLimits = [...limits];
      next[id]--;
      nextLimits[id]--;
      return { discard, ...calculate(engine, next, nextLimits, m) };
    })
    .sort(
      (a, b) =>
        a.shanten - b.shanten ||
        b.total - a.total ||
        tileId(a.discard) - tileId(b.discard),
    );
  return { shanten: current.shanten, mode: "discard", rows };
}
