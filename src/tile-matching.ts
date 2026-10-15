import type { Tile } from "./tiles.ts";

export type Pixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
export type Box = { left: number; top: number; width: number; height: number };
export type TileFeature = { ink: number[]; color: number[]; red: number[]; aspect: number; coverage: number };
export type TileTemplate = TileFeature & { tile: Tile; skin: string };
export type TileMatch = { tile: Tile | null; score: number; margin: number; skin: string };
const FEATURE_WIDTH = 24;
const FEATURE_HEIGHT = 32;

/** Ignore isolated edge pixels when finding the glyph bounds, without erasing printed details. */
function glyphBounds(ink: Float32Array, width: number): Box | null {
  const mask = Uint8Array.from(ink, (value) => +(value > 0.35));
  let left = width, right = -1, top = ink.length / width, bottom = -1;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    const region = [start];
    mask[start] = 0;
    for (let head = 0; head < region.length; head++) {
      const i = region[head], x = i % width;
      for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (mask[next]) { mask[next] = 0; region.push(next); }
      }
    }
    if (region.length < Math.max(2, ink.length * 0.003)) continue;
    for (const i of region) {
      left = Math.min(left, i % width); right = Math.max(right, i % width);
      top = Math.min(top, Math.floor(i / width)); bottom = Math.max(bottom, Math.floor(i / width));
    }
  }
  return right < left ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Collect connected bright regions; the high-threshold pass isolates shaded tiles' bevels. */
function lightRegions(image: Pixels, minimum: number, includeTint: boolean): Box[] {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const lo = Math.min(r, g, b), hi = Math.max(r, g, b);
    const neutral = lo >= minimum && hi - lo < 48;
    // Pale pink can fall below both neutral thresholds; exclude pale yellow UI tags from this bridge.
    const palePink = r - Math.max(g, b) > (hi - lo) / 2;
    const tinted = includeTint && lo >= 145 && hi >= 195 && hi - lo < 90 && (hi - lo >= 48 || palePink);
    mask[i] = +(data[i * 4 + 3] > 240 && hi < 253 && (neutral || tinted));
  }
  const queue = new Int32Array(mask.length);
  const boxes: Box[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    let head = 0, tail = 1;
    queue[0] = start;
    mask[start] = 0;
    let left = width, right = 0, top = height, bottom = 0;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (mask[next]) { mask[next] = 0; queue[tail++] = next; }
      }
    }
    const w = right - left + 1, h = bottom - top + 1;
    if (w >= 15 && h >= 3 && tail > w * h * 0.16)
      boxes.push({ left, top, width: w, height: h });
  }
  return boxes;
}

/** Extend separate bright bevels over darker faces without joining neighboring tile bodies. */
function shadedFaces(image: Pixels): Box[] {
  const bevels = lightRegions(image, 195, false).filter((box) =>
    box.height < box.width * 0.75 && box.width < box.height * 8);
  return bevels.map((bevel) => {
    let bottom = bevel.top + bevel.height;
    for (let y = bottom; y < Math.min(image.height, bevel.top + bevel.width * 2.4); y++) {
      let light = 0;
      for (let x = bevel.left; x < bevel.left + bevel.width; x++) {
        const i = (y * image.width + x) * 4;
        const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
        if (image.data[i + 3] > 240 && Math.min(r, g, b) >= 140 && Math.max(r, g, b) - Math.min(r, g, b) < 48) light++;
      }
      if (light < bevel.width * 0.12) break;
      bottom = y + 1;
    }
    return { ...bevel, height: bottom - bevel.top };
  }).filter((box) => box.height >= 24 && box.width / box.height <= 1.05);
}

/** Locate normal or tinted faces, falling back to bevel-guided bounds for shaded 3D tiles. */
export function findTileFaces(image: Pixels): Box[] {
  const faces = lightRegions(image, 180, true).filter((box) =>
    box.height >= 24 && box.width / box.height >= 0.4 && box.width / box.height <= 1.05);
  const shaded = shadedFaces(image).filter((box) => !faces.some((face) =>
    box.left + box.width / 2 >= face.left && box.left + box.width / 2 < face.left + face.width &&
    box.top >= face.top && box.top < face.top + face.height));
  const boxes = faces.concat(shaded);
  // Discard nested fragments only after rejecting wide background regions as non-tiles.
  return boxes.filter((box) => !boxes.some((outer) => outer !== box &&
    outer.left <= box.left && outer.top <= box.top &&
    outer.left + outer.width >= box.left + box.width && outer.top + outer.height >= box.top + box.height));
}

/** Keep one aligned row only; reject full tables and extra rows instead of guessing ownership. */
export function findHandRow(image: Pixels): Box[] {
  const boxes = findTileFaces(image);
  const rows = boxes.map((anchor) => boxes.filter((box) =>
    Math.abs(box.width / anchor.width - 1) < 0.22 &&
    Math.abs(box.height / anchor.height - 1) < 0.25 &&
    Math.abs(box.top - anchor.top) < anchor.height * 0.35,
  )).sort((a, b) => b.length - a.length || b[0].height - a[0].height);
  const row = rows[0]?.sort((a, b) => a.left - b.left);
  if (!row?.length || row.length > 14 || row[0].height < image.height * 0.45 ||
      boxes.some((box) => !row.includes(box) && box.height > row[0].height * 0.75))
    throw new Error("请框选自己横向排列的手牌，保留完整牌面并排除副露，再使用本地识牌。");
  for (let i = 1; i < row.length; i++) {
    const gap = row[i].left - row[i - 1].left - row[i - 1].width;
    // Disjoint slanted faces can overlap in axis-aligned bounds without hiding each other.
    if (gap < -row[i].width * 0.3 || gap > row[i].width * 1.5)
      throw new Error("牌面边界不连续，请重新框选完整手牌区域。");
  }
  return row;
}

/** Normalize the printed glyph independently of borders, retaining red/green/blue and shape. */
export function describeTile(image: Pixels, box: Box): TileFeature {
  // Two pixels remove tiny GIF seams without trimming the geometric bounds used for rectification.
  const pad = Math.max(2, Math.round(box.width * 0.04));
  const left = box.left + pad, top = box.top + pad;
  const width = box.width - pad * 2, height = box.height - pad * 2;
  const brightness: number[] = [];
  const channels: number[][] = [[], [], []];
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
    const i = (y * image.width + x) * 4;
    brightness.push(Math.max(image.data[i], image.data[i + 1], image.data[i + 2]));
    for (let channel = 0; channel < 3; channel++) channels[channel].push(image.data[i + channel]);
  }
  brightness.sort((a, b) => a - b);
  const background = brightness[Math.floor(brightness.length * 0.8)];
  const backgroundColor = channels.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length * 0.8)]);
  // Remove the face's color cast before measuring glyph color: a pink face is not a red five.
  const tinted = Math.max(...backgroundColor) - Math.min(...backgroundColor) >= 48;
  const correction = backgroundColor.map((value) => tinted ? background - value : 0);
  // A colored overlay also reduces contrast. Restore a 200-level ink/background range so
  // the dim red center of five circles survives. Ignore isolated dark noise and cap the gain at 2x.
  const dark = Math.min(...channels.map((values, i) => values[Math.floor(values.length * 0.1)] + correction[i]));
  // Blank faces have no ink contrast to restore; leave their JPEG noise below the existing cutoff.
  const inkScale = tinted && background - dark > 45 ? Math.max(1, 200 / Math.max(100, background - dark)) : 1;
  const ink = new Float32Array(width * height);
  const redInk = new Float32Array(width * height);
  const color = [0, 0, 0];
  let total = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = ((top + y) * image.width + left + x) * 4;
    const r = Math.min(255, image.data[i] + correction[0]);
    const g = Math.min(255, image.data[i + 1] + correction[1]);
    const b = Math.min(255, image.data[i + 2] + correction[2]);
    const strength = image.data[i + 3] < 240 ? 0 : Math.max(0, Math.min(1, ((background - Math.min(r, g, b)) * inkScale - 45) / 100));
    ink[y * width + x] = strength;
    redInk[y * width + x] = r - Math.max(g, b) > Math.max(15, (background - Math.min(r, g, b)) * 0.15) ? strength : 0;
    total += strength;
    color[0] += strength * Math.max(0, r - Math.max(g, b)) / 255;
    color[1] += strength * Math.max(0, g - Math.max(r, b)) / 255;
    color[2] += strength * Math.max(0, b - Math.max(r, g)) / 255;
  }
  const coverage = total / (width * height);
  const normalized = new Array<number>(FEATURE_WIDTH * FEATURE_HEIGHT).fill(0);
  const glyph = glyphBounds(ink, width);
  if (!glyph || coverage < 0.003) return { ink: normalized, color: [0, 0, 0], red: [0, 0], aspect: 0, coverage };
  const { left: x0, top: y0, width: glyphWidth, height: glyphHeight } = glyph;
  let upperInk = 0, upperRed = 0, allInk = 0, allRed = 0;
  for (let y = y0; y < y0 + glyphHeight; y++) for (let x = x0; x < x0 + glyphWidth; x++) {
    const i = y * width + x;
    allInk += ink[i]; allRed += redInk[i];
    if (y < y0 + glyphHeight * 0.4) { upperInk += ink[i]; upperRed += redInk[i]; }
  }
  // Area averaging preserves thin strokes when downscaling and antialiases enlarged GIFs.
  for (let ny = 0; ny < FEATURE_HEIGHT; ny++) for (let nx = 0; nx < FEATURE_WIDTH; nx++) {
    const ax = x0 + nx * glyphWidth / FEATURE_WIDTH, bx = x0 + (nx + 1) * glyphWidth / FEATURE_WIDTH;
    const ay = y0 + ny * glyphHeight / FEATURE_HEIGHT, by = y0 + (ny + 1) * glyphHeight / FEATURE_HEIGHT;
    let sum = 0;
    for (let y = Math.floor(ay); y < Math.ceil(by); y++) for (let x = Math.floor(ax); x < Math.ceil(bx); x++) {
      const weight = (Math.min(bx, x + 1) - Math.max(ax, x)) * (Math.min(by, y + 1) - Math.max(ay, y));
      sum += (ink[y * width + x] ?? 0) * weight;
    }
    normalized[ny * FEATURE_WIDTH + nx] = sum / ((bx - ax) * (by - ay));
  }
  return {
    ink: normalized, color: color.map((v) => v / total), red: [upperRed / (upperInk || 1), allRed / (allInk || 1)],
    aspect: glyphWidth / glyphHeight, coverage,
  };
}

/** Compare soft glyph masks with one-pixel translation tolerance; colors distinguish red fives. */
function similarity(a: TileFeature, b: TileTemplate): number {
  if (a.coverage < 0.006 || b.coverage < 0.006)
    return a.coverage < 0.006 && b.coverage < 0.006 ? 1 : 0;
  let best = 0;
  const manzu = b.tile[1] === "m";
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const dot = [0, 0], normA = [0, 0], normB = [0, 0];
    for (let y = 0; y < FEATURE_HEIGHT; y++) for (let x = 0; x < FEATURE_WIDTH; x++) {
      const av = a.ink[y * FEATURE_WIDTH + x];
      const bv = x + dx >= 0 && x + dx < FEATURE_WIDTH && y + dy >= 0 && y + dy < FEATURE_HEIGHT
        ? b.ink[(y + dy) * FEATURE_WIDTH + x + dx] : 0;
      const region = y < FEATURE_HEIGHT * 0.4 ? 0 : 1;
      dot[region] += av * bv; normA[region] += av * av; normB[region] += bv * bv;
    }
    // The shared 萬 glyph must not swamp the numeral that distinguishes manzu ranks.
    const shape = manzu
      ? 0.7 * 2 * dot[0] / (normA[0] + normB[0] || 1) + 0.3 * 2 * dot[1] / (normA[1] + normB[1] || 1)
      : 2 * (dot[0] + dot[1]) / (normA[0] + normB[0] + normA[1] + normB[1] || 1);
    best = Math.max(best, shape);
  }
  const colorDistance = a.color.reduce((sum, v, i) => sum + Math.abs(v - b.color[i]), 0);
  // Red coverage tolerates dim rendering better than absolute red-channel intensity.
  const redDistance = manzu || b.tile[0] === "0" || b.tile[0] === "5" ? Math.abs(a.red[manzu ? 0 : 1] - b.red[manzu ? 0 : 1]) : 0;
  return best - colorDistance * 0.6 - redDistance * 0.2 - Math.min(0.3, Math.abs(Math.log(a.aspect / b.aspect)) * 0.12);
}

/** Rank distinct tile labels across skins, keeping weak or ambiguous matches as unknown. */
export function matchTile(feature: TileFeature, templates: TileTemplate[]): TileMatch {
  const labels = new Map<Tile, { tile: Tile; skin: string; score: number }>();
  for (const template of templates) {
    const score = similarity(feature, template);
    if (score > (labels.get(template.tile)?.score ?? -Infinity))
      labels.set(template.tile, { tile: template.tile, skin: template.skin, score });
  }
  const ranked = [...labels.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0], margin = best.score - ranked[1].score;
  return { ...best, margin, tile: best.score >= 0.76 && margin >= 0.055 ? best.tile : null };
}
