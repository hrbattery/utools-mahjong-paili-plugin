import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeHand, loadEngine } from "../src/analysis.ts";
import {
  countTiles,
  formatTiles,
  parseMelds,
  parseTiles,
  tileId,
  validateHand,
} from "../src/tiles.ts";
import { parseRecognition } from "../src/recognition.ts";

const engine = await loadEngine(
  readFileSync(new URL("../src/paili_engine.wasm", import.meta.url)),
);
const analyze = (hand: string, melds = "", discarded = "") =>
  analyzeHand(
    engine,
    parseTiles(hand),
    parseMelds(melds),
    parseTiles(discarded),
  );

test("Tenhou text roundtrips without losing red fives or screenshot order", () => {
  const tiles = parseTiles("123M 405p 76z 1m");
  assert.equal(formatTiles(tiles), "123m405p76z1m");
  assert.equal(tileId("0p"), tileId("5p"));
  assert.equal(countTiles(parseTiles("0555p"))[13], 4);
  for (const invalid of ["123", "123x", "8z", "0z", "abc123m", "1m?2p"])
    assert.throws(() => parseTiles(invalid));
});

test("all 3n+2 sizes and post-discard 3n+1 sizes are accepted", () => {
  for (const hand of [
    "12m",
    "123m12p",
    "123m456p12s",
    "123m456p789s12z",
    "123m456p789s111z23z",
  ]) {
    assert.doesNotThrow(() => analyze(hand));
    const tiles = parseTiles(hand);
    tiles.pop();
    assert.doesNotThrow(() => analyzeHand(engine, tiles));
  }
  for (const hand of ["", "123m", "123456m", "1111123456789m1z"])
    assert.throws(() => analyze(hand));
});

test("meld parsing and aggregate counts handle chi, pon, kan and red fives", () => {
  assert.equal(parseMelds("123m 055p 7777z").length, 3);
  for (const invalid of ["124m", "123z", "112p", "11111s"])
    assert.throws(() => parseMelds(invalid));
  assert.throws(() => analyze("555m12p", "555m"));
  assert.throws(() => analyze("123m456p789s111z23z", "111m"));
  assert.throws(() => validateHand(parseTiles("05555m")));
});

test("ordinary, seven-pair and thirteen-orphan completions are recognized", () => {
  for (const hand of [
    "123m123p123s111z22z",
    "1122m3344p5566s77z",
    "19m19p19s1234567z1m",
    "11m",
    "123m11z",
  ]) {
    assert.equal(analyze(hand).shanten, -1, hand);
  }
  assert.equal(analyze("19m19p19s1234567z").rows[0].waits.length, 13);
  assert.equal(analyze("19m19p19s1234567z").rows[0].total, 39);
  // Four triplets leave two different singleton tiles; neither can become a fifth copy.
  // Replacing both singletons with a new pair takes two draws, so this is one-shanten.
  assert.equal(analyze("11112222333444z").shanten, 1);
});

test("11-tile hand respects a supplied kan that exhausts its apparent wait", () => {
  const plain = analyze("13m123456p11s1z").rows.find(
    (row) => row.discard === "1z",
  )!;
  assert.equal(plain.shanten, 0);
  assert.deepEqual(plain.waits, [{ tile: "2m", remaining: 4 }]);
  const exhausted = analyze("13m123456p11s1z", "2222m").rows.find(
    (row) => row.discard === "1z",
  )!;
  assert.equal(exhausted.shanten, 1);
  assert.ok(exhausted.waits.every((wait) => wait.tile !== "2m"));
});

test("known melds reduce effective tile counts, including all four kan copies", () => {
  const row = analyze("123m45p11z1s").rows.find((row) => row.discard === "1s")!;
  assert.deepEqual(row.waits, [
    { tile: "3p", remaining: 4 },
    { tile: "6p", remaining: 4 },
  ]);
  const known = analyze("123m45p11z1s", "3333p").rows.find(
    (row) => row.discard === "1s",
  )!;
  assert.deepEqual(known.waits, [{ tile: "6p", remaining: 4 }]);
});

test("discard simulation retains known copies and matches the candidate result", () => {
  const hand = parseTiles("123m245779p13555z");
  for (const row of analyzeHand(engine, hand).rows) {
    const after = [...hand];
    after.splice(after.indexOf(row.discard!), 1);
    const simulated = analyzeHand(engine, after, [], [row.discard!]).rows[0];
    assert.equal(row.shanten, simulated.shanten);
    assert.deepEqual(row.waits, simulated.waits);
    for (const wait of row.waits)
      assert.equal(wait.remaining, 4 - countTiles(hand)[tileId(wait.tile)]);
  }
});

test("red and ordinary fives remain selectable but have equal mathematical results", () => {
  const result = analyze("123m405p789s11223z");
  const red = result.rows.find((row) => row.discard === "0p")!;
  const normal = result.rows.find((row) => row.discard === "5p")!;
  assert.equal(red.shanten, normal.shanten);
  assert.deepEqual(red.waits, normal.waits);
});

test("effective masks agree with exhaustive legal draws on deterministic random hands", () => {
  let seed = 8128;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let sample = 0; sample < 25; sample++) {
    const hand: string[] = [];
    const counts = Array(34).fill(0);
    const size = 1 + 3 * (sample % 5);
    while (hand.length < size) {
      const id = random() % 34;
      if (counts[id] === 4) continue;
      counts[id]++;
      hand.push(
        `${id < 27 ? (id % 9) + 1 : id - 26}${"mpsz"[Math.floor(id / 9)]}`,
      );
    }
    const row = analyzeHand(engine, hand).rows[0];
    const expected: string[] = [];
    for (let id = 0; id < 34; id++) {
      if (counts[id] === 4) continue;
      const tile = `${(id % 9) + 1}${"mpsz"[Math.floor(id / 9)]}`;
      if (analyzeHand(engine, [...hand, tile]).shanten < row.shanten)
        expected.push(tile);
    }
    assert.deepEqual(
      row.waits.map((wait) => wait.tile),
      expected,
    );
  }
});

test("recognition preserves unknown positions and rejects malformed model output", () => {
  assert.deepEqual(
    parseRecognition('```json\n{"tiles":["1m",null,"0p"],"notes":"模糊"}\n```'),
    { tiles: ["1m", null, "0p"], notes: "模糊" },
  );
  for (const response of [
    "not json",
    "{}",
    '{"tiles":[]}',
    '{"tiles":["8z"]}',
    '{"tiles":["?m"]}',
    JSON.stringify({ tiles: Array(15).fill("1m") }),
  ]) {
    assert.throws(() => parseRecognition(response));
  }
});
