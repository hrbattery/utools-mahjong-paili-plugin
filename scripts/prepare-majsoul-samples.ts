import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { parseMelds, parseTiles, validateHand } from "../src/tiles.ts";

const run = promisify(execFile);
const output = new URL("../samples/private/majsoul/", import.meta.url);
const sources = JSON.parse(
  await readFile(
    new URL("../samples/majsoul-sources.json", import.meta.url),
    "utf8",
  ),
);
await mkdir(output, { recursive: true });
const samples = [];
// Source bytes stay intact. Crops and labels share the original sample's split.
for (const source of sources) {
  const fullPath = new URL(source.full_image, output);
  try {
    await access(fullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const { stdout } = await run(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        "30",
        source.source_image,
      ],
      { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
    );
    await sharp(stdout).metadata();
    await writeFile(fullPath, stdout);
  }
  const original = await readFile(fullPath);
  const metadata = await sharp(original).metadata();
  const tiles = parseTiles(source.hand);
  validateHand(tiles, parseMelds(source.melds));
  const handImage = `${source.id}-hand.png`;
  await sharp(original)
    .extract(source.crop)
    .png()
    .toFile(fileURLToPath(new URL(handImage, output)));
  samples.push({
    ...source,
    platform: "majsoul",
    source_kind: "public-screenshot",
    annotation_status: "assistant-visual-review",
    hand_image: handImage,
    tiles,
    tile_count: tiles.length,
    width: metadata.width,
    height: metadata.height,
    full_image_sha256: createHash("sha256").update(original).digest("hex"),
  });
}
await writeFile(
  new URL("manifest.json", output),
  JSON.stringify(
    {
      description: "公开雀魂对局截图；助手逐图目视标注，尚未运行真实识牌模型。",
      search_query: "雀魂 对局截图",
      samples,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${samples.length} original screenshots and hand crops: ${fileURLToPath(output)}`,
);
