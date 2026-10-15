import library from "./generated/tile-templates.json" with { type: "json" };
import { describeTile, findHandRow, matchTile } from "./tile-matching.ts";
import type { Box, Pixels, TileMatch, TileTemplate } from "./tile-matching.ts";
import type { RecognizedHand } from "./recognition.ts";
import { rectifyFace } from "./tile-geometry.ts";

export type LocalHand = RecognizedHand & { boxes: Box[]; matches: TileMatch[] };
let templates: TileTemplate[] | undefined;

/** Decode the embedded masks once; local recognition never fetches assets or calls a service. */
function loadTemplates(): TileTemplate[] {
  return templates ??= library.templates.map((template) => ({
    ...template,
    ink: Array.from(atob(template.ink), (char) => char.charCodeAt(0) / 255),
  }));
}

/** Recognize a cropped upright hand, yielding between tiles so edits can cancel stale work. */
export async function recognizeLocal(
  image: Pixels,
  isCancelled: () => boolean = () => false,
): Promise<LocalHand> {
  if (image.width * image.height > 4_000_000 || image.data.length !== image.width * image.height * 4)
    throw new Error("图片过大或像素无效，请先裁剪手牌区域。");
  const boxes = findHandRow(image);
  const bank = loadTemplates();
  const matches: TileMatch[] = [];
  for (const box of boxes) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (isCancelled()) throw new Error("本次识别已取消。");
    const rectified = rectifyFace(image, box);
    const feature = rectified
      ? describeTile(rectified.image, { left: 0, top: 0, width: rectified.image.width, height: rectified.image.height })
      : describeTile(image, box);
    matches.push(matchTile(feature, bank));
  }
  const unknown = matches.filter((match) => match.tile === null).length;
  return {
    tiles: matches.map((match) => match.tile), boxes, matches,
    notes: `本地匹配 ${boxes.length} 张${unknown ? `，${unknown} 张待校正` : ""}。请核对牌数、赤五和白板。`,
  };
}
