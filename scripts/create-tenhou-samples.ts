import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { PALETTE, parseTiles, validateHand } from "../src/tiles.ts";

const run = promisify(execFile);
const source = "https://cdn.tenhou.net/2/t/";
const output = new URL("../samples/private/tenhou/", import.meta.url);
const cases: { id: string; hand: string; draw_gap: boolean; tags: string[] }[] =
  JSON.parse(
    await readFile(
      new URL("../samples/tenhou-cases.json", import.meta.url),
      "utf8",
    ),
  );

/** Cache the exact GIF bytes and record provenance; reject missing or malformed assets. */
async function loadTile(tile: string) {
  const url = `${source}${tile}.gif`;
  const path = new URL(`tiles/${tile}.gif`, output);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const result = await run(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        "30",
        url,
      ],
      { encoding: "buffer", maxBuffer: 1024 * 1024 },
    );
    bytes = result.stdout;
  }
  const metadata = await sharp(bytes).metadata();
  if (
    metadata.format !== "gif" ||
    metadata.width !== 31 ||
    metadata.height !== 47
  )
    throw new Error(`${tile}: expected a 31×47 GIF from ${url}`);
  await writeFile(path, bytes);
  return {
    tile,
    url,
    file: `tiles/${tile}.gif`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Compose pixels in the labelled order, keeping labels out of the recognition image. */
async function composeHand(sample: (typeof cases)[number]) {
  const tiles = parseTiles(sample.hand);
  validateHand(tiles);
  const padding = 12;
  const gap = sample.draw_gap ? 16 : 0;
  const width = padding * 2 + tiles.length * 31 + gap;
  const height = padding * 2 + 47;
  const tileBoxes = tiles.map((tile, index) => ({
    tile,
    left: padding + index * 31 + (index === tiles.length - 1 ? gap : 0),
    top: padding,
    width: 31,
    height: 47,
  }));
  const file = `${sample.id}.png`;
  await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(
      tileBoxes.map(({ tile, left, top }) => ({
        input: fileURLToPath(new URL(`tiles/${tile}.gif`, output)),
        left,
        top,
      })),
    )
    .png()
    .toFile(fileURLToPath(new URL(file, output)));
  return {
    ...sample,
    platform: "tenhou",
    source_kind: "synthetic-tiles",
    split: "development",
    hand_image: file,
    tiles,
    tile_count: tiles.length,
    width,
    height,
    tile_boxes: tileBoxes,
    melds: "",
    melds_complete: tiles.length >= 13,
  };
}

await mkdir(new URL("tiles/", output), { recursive: true });
const assets: Awaited<ReturnType<typeof loadTile>>[] = [];
// Keep source requests bounded; repeat runs use the existing local GIF cache.
for (let index = 0; index < PALETTE.length; index += 4) {
  assets.push(
    ...(await Promise.all(PALETTE.slice(index, index + 4).map(loadTile))),
  );
}
const samples = [];
for (const sample of cases) samples.push(await composeHand(sample));
await writeFile(
  new URL("manifest.json", output),
  JSON.stringify(
    {
      description:
        "天凤牌面素材合成样本，不是真实游戏截图；标签不传给识别模型。",
      source,
      assets,
      samples,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Generated ${samples.length} labelled PNG hands from ${assets.length} GIF assets: ${fileURLToPath(output)}`,
);
