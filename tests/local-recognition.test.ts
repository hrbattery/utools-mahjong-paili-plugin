import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { PALETTE } from "../src/tiles.ts";
import { recognizeLocal } from "../src/local-recognition.ts";
import { findHandRow, findTileFaces } from "../src/tile-matching.ts";
import type { Pixels } from "../src/tile-matching.ts";
import { rectifyFace } from "../src/tile-geometry.ts";

const skins = ["majsoul-standard", "majsoul-cat-saint", "majsoul-birdie-fishie", "tenhou-standard"];

/** Decode test images through sharp, leaving the production matcher independent of Node and DOM. */
async function pixels(input: Buffer): Promise<Pixels> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { ...info, data };
}

/** Compose unsorted tiles with a separate draw and an optional raised tile, then resample the image. */
async function hand(skin: string, tiles: string[], scale: number, raised = false): Promise<Buffer> {
  const w = skin === "tenhou-standard" ? 31 : 80;
  const h = skin === "tenhou-standard" ? 47 : 129;
  const padding = 12, gap = Math.round(w * 0.4), lift = raised ? Math.round(h * 0.16) : 0;
  const width = padding * 2 + tiles.length * w + gap, height = padding * 2 + h + lift;
  const composite = await Promise.all(tiles.map(async (tile, i) => ({
    input: await readFile(new URL(`../assets/recognition-templates/${skin}/${tile}.png`, import.meta.url)),
    left: padding + i * w + (i === tiles.length - 1 ? gap : 0), top: padding + (raised && i === 1 ? 0 : lift),
  })));
  const buffer = await sharp({ create: { width, height, channels: 4, background: "#20394f" } }).composite(composite).png().toBuffer();
  return sharp(buffer).resize(Math.round(width * scale)).png().toBuffer();
}

/** Render a known face with a simple camera model, independently of the production corner solver. */
async function perspectiveFace(tile: string, shear: number): Promise<Pixels> {
  const file = new URL(`../assets/recognition-templates/majsoul-standard/${tile}.png`, import.meta.url);
  const original = await pixels(await readFile(file));
  const face = findTileFaces(original)[0];
  const source = await pixels(await sharp(file.pathname).extract(face).resize(48, 72).png().toBuffer());
  const width = 90, height = 78, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dy = y - 8, dx = x - 20;
    // y' = 0.85*y/(1+0.1*y/72), x' = (x+shear*y)/(1+0.1*y/72).
    const sy = dy / (0.85 - 0.1 * dy / 72), sx = dx * (1 + 0.1 * sy / 72) - shear * sy;
    const i = (y * width + x) * 4;
    if (sx >= 0 && sx <= 47 && sy >= 0 && sy <= 71) {
      const j = (Math.round(sy) * 48 + Math.round(sx)) * 4;
      data.set(source.data.subarray(j, j + 4), i);
    } else data.set([32, 57, 79, 255], i);
  }
  return { width, height, data };
}

test("projective faces recover numeral, bamboo, circle, honor and red-five labels in both directions", async () => {
  for (const shear of [-0.14, 0.14]) {
    for (const tile of ["2m", "3m", "0m", "6s", "0s", "8p", "0p", "1z", "5z"]) {
      const image = await perspectiveFace(tile, shear);
      assert(rectifyFace(image, findHandRow(image)[0]), `rectify ${tile}, shear ${shear}`);
      assert.deepEqual((await recognizeLocal(image)).tiles, [tile], `${tile}, shear ${shear}`);
    }
  }
});

test("upright faces keep their original geometry and missing outlines are rejected", async () => {
  const image = await pixels(await hand("majsoul-standard", ["3m", "0p", "5z"], 1));
  for (const box of findHandRow(image)) assert.equal(rectifyFace(image, box), null);
  const dark = { width: 48, height: 48, data: new Uint8ClampedArray(48 * 48 * 4) };
  assert.equal(rectifyFace(dark, { left: 0, top: 0, width: 48, height: 48 }), null);
});

test("muted red fives remain distinct from normal fives after JPEG compression", async () => {
  for (const tile of ["0m", "5m", "0p", "5p", "0s", "5s"]) {
    const faded = await sharp(await hand("tenhou-standard", [tile], 2)).modulate({ saturation: 0.6 }).jpeg({ quality: 65 }).toBuffer();
    assert.deepEqual((await recognizeLocal(await pixels(faded))).tiles, [tile]);
  }
});

test("small disconnected corner artifacts do not change the normalized manzu numeral", async () => {
  for (const tile of ["1m", "2m", "3m"]) {
    const image = await pixels(await hand("tenhou-standard", [tile], 2));
    const box = findHandRow(image)[0];
    for (let y = box.top + 4; y < box.top + 6; y++) for (let x = box.left + 4; x < box.left + 6; x++) {
      image.data.set([20, 20, 20, 255], (y * image.width + x) * 4);
    }
    assert.deepEqual((await recognizeLocal(image)).tiles, [tile]);
  }
});

for (const skin of skins) {
  test(`${skin}: all 37 labels survive resampling, unsorted order and draw gaps`, async () => {
    // Coprime stride scrambles suits and ranks independently of atlas order.
    const labels = PALETTE.map((_, i) => PALETTE[(i * 13) % PALETTE.length]);
    for (const scale of skin === "tenhou-standard" ? [1, 2] : [0.65, 1.25]) {
      for (let start = 0; start < labels.length; start += 14) {
        const expected = labels.slice(start, start + 14);
        const result = await recognizeLocal(await pixels(await hand(skin, expected, scale)));
        assert.deepEqual(result.tiles, expected, `${skin}, scale ${scale}, offset ${start}`);
      }
    }
  });
}

test("raised tile, repeated white dragons and all three red fives retain their positions", async () => {
  const expected = ["5z", "5z", "0m", "5m", "0p", "5p", "0s", "5s"];
  for (const skin of skins) {
    const result = await recognizeLocal(await pixels(await hand(skin, expected, 1, true)));
    assert.deepEqual(result.tiles, expected, skin);
  }
});

test("pink highlights and shaded slanted faces retain every tile boundary", async () => {
  // Adjacent parallelograms have disjoint faces but overlapping axis-aligned bounds.
  // The light upper bevel must not be mistaken for the full, darker printed face.
  for (const slant of [0, 9]) {
    const faces = Array.from({ length: 8 }, (_, i) => {
      const x = 12 + i * 35, fill = i === 7 ? "#dfa7a0" : "#b2b0a6";
      return `<path d="M${x + slant} 8 h33 l-${slant} 58 h-33 Z" fill="${fill}"/>
        <path d="M${x + slant} 8 h33 l-${slant / 6} 10 h-33 Z" fill="#e6e1cf"/>`;
    }).join("");
    const image = await pixels(Buffer.from(`<svg width="310" height="78"><rect width="310" height="78" fill="#20394f"/>${faces}</svg>`));
    const boxes = findHandRow(image);
    assert.equal(boxes.length, 8, `slant ${slant}`);
    for (const [i, box] of boxes.entries()) {
      assert(box.left <= 12 + i * 35 + 16 && box.left + box.width >= 12 + i * 35 + 16);
      assert(box.height >= 54, "include the shaded body, not only its bevel");
    }
  }
});

test("pale and stronger pink regions stay connected across a highlighted face", async () => {
  const expected = ["2p", "5p", "1s", "5z"];
  for (const scale of [0.65, 1]) {
    const image = await pixels(await hand("majsoul-standard", expected, scale));
    const original = findHandRow(image);
    // Reproduce the pale-pink gap in the real screenshot without storing its copyrighted pixels.
    // The two halves have color spreads below and above 48, but belong to one intact face.
    for (const box of original.slice(0, 2)) {
      for (let y = box.top; y < box.top + box.height; y++) for (let x = box.left; x < box.left + box.width; x++) {
        const i = (y * image.width + x) * 4;
        const rgb = image.data.subarray(i, i + 3);
        if (Math.min(...rgb) < 140 || Math.max(...rgb) < 180 || Math.max(...rgb) - Math.min(...rgb) >= 48) continue;
        image.data.set(x < box.left + box.width / 2 ? [220, 178, 176] : [225, 178, 176], i);
      }
    }
    const boxes = findHandRow(image);
    assert.equal(boxes.length, expected.length);
    for (const [i, box] of boxes.entries()) {
      assert(Math.abs(box.left - original[i].left) <= 1, `full left edge, tile ${i}, scale ${scale}`);
      assert(Math.abs(box.width - original[i].width) <= 1, `full width, tile ${i}, scale ${scale}`);
    }
    assert.deepEqual((await recognizeLocal(image)).tiles, expected);
  }
});

test("a pale yellow tag touching the top of a tile does not extend its face bounds", async () => {
  const image = await pixels(await hand("majsoul-standard", ["1z"], 0.65));
  const [box] = findHandRow(image);
  for (let y = Math.max(0, box.top - 12); y < box.top; y++) for (let x = box.left + 8; x < box.left + box.width - 8; x++)
    image.data.set([220, 214, 176, 255], (y * image.width + x) * 4);
  assert.deepEqual(findHandRow(image), [box]);
  assert.deepEqual((await recognizeLocal(image)).tiles, ["1z"]);
});

test("a red highlight is removed from the face background without turning ordinary fives red", async () => {
  const expected = ["0m", "5m", "0p", "5p", "0s", "5s"];
  const tinted = await sharp(await hand("tenhou-standard", expected, 2)).removeAlpha()
    .linear([0.72, 0.72, 0.72], [71, 0, 0]).png().toBuffer();
  const result = await recognizeLocal(await pixels(tinted));
  assert.equal(result.tiles.length, expected.length);
  for (const [i, tile] of result.tiles.entries()) {
    // Strongly tinted red fives may remain unknown; ordinary fives must not become red.
    if (expected[i].startsWith("0")) assert(tile === expected[i] || tile === null);
    else assert.equal(tile, expected[i]);
  }
});

test("pink JPEG highlights distinguish four and five circles without forcing other ranks into five", async () => {
  for (const tile of ["4p", "5p", "0p", "6p", "5z"]) {
    const source = await readFile(new URL(`../assets/recognition-templates/majsoul-standard/${tile}.png`, import.meta.url));
    const framed = await sharp({ create: { width: 104, height: 153, channels: 4, background: "#20394f" } })
      .composite([{ input: source, left: 12, top: 12 }]).png().toBuffer();
    for (const scale of [0.65, 1]) for (const quality of [60, 80]) {
      // A 40% pink overlay weakens the center red circle relative to the four black corners.
      const highlighted = await sharp(framed).removeAlpha().linear([0.6, 0.6, 0.6], [102, 52, 52])
        .resize(Math.round(104 * scale)).jpeg({ quality }).toBuffer();
      const result = await recognizeLocal(await pixels(highlighted));
      const context = `${tile}, scale ${scale}, JPEG ${quality}`;
      if (tile !== "0p") assert.deepEqual(result.tiles, [tile], context);
      else {
        // Strongly tinted red fives may remain unknown; do not force an ordinary five.
        assert.equal(result.tiles.length, 1, context);
        assert(result.tiles[0] === tile || result.tiles[0] === null, context);
      }
    }
  }
});

test("blank images and multiple tile rows request a crop instead of inventing a hand", async () => {
  const blank = await sharp({ create: { width: 400, height: 100, channels: 4, background: "white" } }).png().toBuffer();
  await assert.rejects(recognizeLocal(await pixels(blank)), /框选/);
  const row = await hand("majsoul-standard", ["1m", "2m", "3m"], 1);
  const metadata = await sharp(row).metadata();
  const two = await sharp({ create: { width: metadata.width!, height: metadata.height! * 2, channels: 4, background: "#20394f" } })
    .composite([{ input: row, top: 0, left: 0 }, { input: row, top: metadata.height!, left: 0 }]).png().toBuffer();
  await assert.rejects(recognizeLocal(await pixels(two)), /框选/);
});

test("a large light crop background does not hide separate tile faces", async () => {
  const expected = ["1m", "2p", "3s", "5z"];
  const image = await pixels(await hand("majsoul-standard", expected, 1));
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i] === 32 && image.data[i + 1] === 57 && image.data[i + 2] === 79)
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 205;
  }
  assert.deepEqual((await recognizeLocal(image)).tiles, expected);
});

test("unmatched glyph remains unknown and a cancelled run never completes", async () => {
  const source = await readFile(new URL("../assets/recognition-templates/majsoul-standard/5z.png", import.meta.url));
  const unknown = await sharp(source).composite([{ input: Buffer.from('<svg width="80" height="129"><path d="M12 28 L65 105 M65 28 L12 105" stroke="#111" stroke-width="9"/></svg>') }]).png().toBuffer();
  const image = await pixels(unknown);
  assert.deepEqual((await recognizeLocal(image)).tiles, [null]);
  await assert.rejects(recognizeLocal(image, () => true), /取消/);
});

test("standard red fives come from the last atlas column; themed ones from the first", async () => {
  for (const [skin, left] of [["majsoul-standard", 720], ["majsoul-cat-saint", 0], ["majsoul-birdie-fishie", 0]] as const) {
    const source = new URL(`../assets/${skin}/hand.png`, import.meta.url);
    for (const [tile, top] of [["0s", 0], ["0m", 129], ["0p", 258]] as const) {
      const original = await sharp(source.pathname).extract({ left, top, width: 80, height: 129 }).ensureAlpha().raw().toBuffer();
      const exported = await sharp(new URL(`../assets/recognition-templates/${skin}/${tile}.png`, import.meta.url).pathname).ensureAlpha().raw().toBuffer();
      assert.deepEqual(exported, original);
    }
  }
});
