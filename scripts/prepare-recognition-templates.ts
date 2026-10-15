import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { PALETTE } from "../src/tiles.ts";
import { describeTile, findTileFaces } from "../src/tile-matching.ts";

const root = new URL("../", import.meta.url);
const skins = [
  { id: "majsoul-standard", name: "雀魂标准", redFirst: false },
  { id: "majsoul-cat-saint", name: "猫咪雀圣", redFirst: true },
  { id: "majsoul-birdie-fishie", name: "飞鸟与鱼", redFirst: true },
  { id: "tenhou-standard", name: "天凤标准", redFirst: false },
];
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const templates = [];
const manifest = [];

// Source atlases have different red-five columns. Export all 37 labels without reordering pixels.
for (const skin of skins) {
  const sourceDir = new URL(`assets/${skin.id}/`, root);
  const source = JSON.parse(await readFile(new URL("source.json", sourceDir), "utf8"));
  const output = new URL(`assets/recognition-templates/${skin.id}/`, root);
  await mkdir(output, { recursive: true });
  for (const tile of PALETTE) {
    const tenhou = skin.id === "tenhou-standard";
    const sourceFile = tenhou ? `tiles/${tile}.gif` : "hand.png";
    const bytes = await readFile(new URL(sourceFile, sourceDir));
    const record = source.files.find((entry: { file: string }) => entry.file === sourceFile);
    if (!record || sha256(bytes) !== record.sha256) throw new Error(`Source hash mismatch: ${skin.id}/${sourceFile}`);
    const metadata = await sharp(bytes).metadata();
    if (metadata.width !== (tenhou ? 31 : 800) || metadata.height !== (tenhou ? 47 : 516))
      throw new Error(`Unexpected source dimensions: ${skin.id}/${sourceFile}`);
    const rank = Number(tile[0]);
    const column = tile[1] === "z" ? rank - 1 : skin.redFirst ? rank : rank === 0 ? 9 : rank - 1;
    const box = tenhou
      ? { left: 0, top: 0, width: 31, height: 47 }
      : { left: column * 80, top: "smpz".indexOf(tile[1]) * 129, width: 80, height: 129 };
    const png = await sharp(bytes).extract(box).png().toBuffer();
    await writeFile(new URL(`${tile}.png`, output), png);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = { ...info, data };
    const faces = findTileFaces(pixels);
    if (faces.length !== 1) throw new Error(`Expected one face in ${skin.id}/${tile}, found ${faces.length}`);
    const feature = describeTile(pixels, faces[0]);
    templates.push({
      tile, skin: skin.id, ...feature,
      // Quantized masks keep the embedded library small and require no file:// fetch or image decoder.
      ink: Buffer.from(feature.ink.map((v) => Math.round(v * 255))).toString("base64"),
    });
    manifest.push({
      tile, skin: skin.id, name: skin.name, file: `${skin.id}/${tile}.png`,
      width: box.width, height: box.height, sha256: sha256(png),
      source_file: `assets/${skin.id}/${sourceFile}`, source_sha256: sha256(bytes),
      source_url: record.source_url ?? record.url ?? null, source_box: box,
    });
  }
}
await mkdir(new URL("src/generated/", root), { recursive: true });
await writeFile(new URL("src/generated/tile-templates.json", root), JSON.stringify({ skins, templates }) + "\n");
await writeFile(new URL("assets/recognition-templates/manifest.json", root), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Prepared ${templates.length} templates: ${fileURLToPath(new URL("assets/recognition-templates/", root))}`);
