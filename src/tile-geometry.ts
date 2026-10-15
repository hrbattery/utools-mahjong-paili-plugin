import type { Box, Pixels } from "./tile-matching.ts";

type Point = { x: number; y: number };

/** Isolate the largest light face inside its bounds, excluding neighboring slanted corners. */
function faceOutline(image: Pixels, box: Box): Point[] {
  const mask = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    const i = ((box.top + y) * image.width + box.left + x) * 4;
    const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
    const lo = Math.min(r, g, b), hi = Math.max(r, g, b);
    mask[y * box.width + x] = +(image.data[i + 3] > 240 && lo >= 180 && hi < 253 && hi - lo < 48);
  }
  let largest: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    const region = [start];
    mask[start] = 0;
    for (let head = 0; head < region.length; head++) {
      const i = region[head], x = i % box.width;
      for (const next of [x > 0 ? i - 1 : -1, x < box.width - 1 ? i + 1 : -1, i - box.width, i + box.width]) {
        if (mask[next]) { mask[next] = 0; region.push(next); }
      }
    }
    if (region.length > largest.length) largest = region;
  }
  return largest.map((i) => ({ x: i % box.width, y: Math.floor(i / box.width) }));
}

/** Fit a side edge away from rounded corners; reject outlines broken up by glyphs or effects. */
function fitSide(points: Point[], height: number, right: boolean): { slope: number; offset: number; error: number } {
  const edges = new Map<number, number>();
  for (const { x, y } of points) {
    if (y < height * 0.2 || y > height * 0.8) continue;
    edges.set(y, right ? Math.max(edges.get(y) ?? -Infinity, x) : Math.min(edges.get(y) ?? Infinity, x));
  }
  const rows = [...edges];
  const my = rows.reduce((sum, [y]) => sum + y, 0) / rows.length;
  const mx = rows.reduce((sum, [, x]) => sum + x, 0) / rows.length;
  const slope = rows.reduce((sum, [y, x]) => sum + (y - my) * (x - mx), 0) /
    rows.reduce((sum, [y]) => sum + (y - my) ** 2, 0);
  const offset = mx - slope * my;
  const error = Math.sqrt(rows.reduce((sum, [y, x]) => sum + (x - slope * y - offset) ** 2, 0) / rows.length);
  return { slope, offset, error };
}

/** Sample a quadrilateral into a frontal 2:3 face using a projective map and bilinear pixels. */
function warpFace(image: Pixels, corners: Point[]): Pixels {
  const [p0, p1, p2, p3] = corners;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y;
  const width = 48, height = 72, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / (width - 1), v = y / (height - 1), denominator = g * u + h * v + 1;
    const sx = Math.max(0, Math.min(image.width - 1, (a * u + b * v + p0.x) / denominator));
    const sy = Math.max(0, Math.min(image.height - 1, (d * u + e * v + p0.y) / denominator));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    for (let channel = 0; channel < 4; channel++) {
      let value = 0;
      for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
        const i = (Math.min(image.height - 1, y0 + dy) * image.width + Math.min(image.width - 1, x0 + dx)) * 4;
        value += image.data[i + channel] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      }
      data[(y * width + x) * 4 + channel] = value;
    }
  }
  return { width, height, data };
}

/** Rectify visibly tilted or foreshortened faces; leave upright or unreliable outlines unchanged. */
export function rectifyFace(image: Pixels, box: Box): { image: Pixels; corners: Point[] } | null {
  const outline = faceOutline(image, box);
  if (outline.length < box.width * box.height * 0.2) return null;
  const left = fitSide(outline, box.height, false), right = fitSide(outline, box.height, true);
  if (![left.error, right.error].every((error) => Number.isFinite(error) && error <= Math.max(1, box.width * 0.06))) return null;
  const tilt = Math.max(Math.abs(left.slope), Math.abs(right.slope)) * box.height;
  if (tilt < Math.max(2, box.width * 0.08) && box.width / box.height < 0.82) return null;
  const y0 = 1, y1 = box.height - 2;
  const corners = [
    { x: left.offset + left.slope * y0, y: y0 }, { x: right.offset + right.slope * y0, y: y0 },
    { x: right.offset + right.slope * y1, y: y1 }, { x: left.offset + left.slope * y1, y: y1 },
  ];
  if (corners.some((p) => p.x < -2 || p.x > box.width + 1) ||
      corners[1].x - corners[0].x < box.width * 0.5 || corners[2].x - corners[3].x < box.width * 0.5) return null;
  const absolute = corners.map((p) => ({ x: box.left + p.x, y: box.top + p.y }));
  return { image: warpFace(image, absolute), corners: absolute };
}
