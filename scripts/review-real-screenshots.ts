import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import { recognizeLocal } from "../src/local-recognition.ts";

const run = promisify(execFile);
const root = new URL("../", import.meta.url);
const holdout = process.argv.includes("--holdout");
const output = new URL(`samples/private/${holdout ? "shape-holdout" : "real-review"}-2026-10-15/`, root);
const sources = JSON.parse(await readFile(new URL(`samples/${holdout ? "shape-holdout" : "real-screenshot"}-sources.json`, root), "utf8"));
const results = [];
await mkdir(output, { recursive: true });

/** Record exact bytes so downloaded images and the evaluated engine remain auditable. */
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const engineHashes: Record<string, string> = {};
for (const path of ["src/local-recognition.ts", "src/tile-matching.ts", "src/tile-geometry.ts", "src/generated/tile-templates.json"])
  engineHashes[path] = sha256(await readFile(new URL(path, root)));

// Cache untouched originals, then crop by the visually reviewed coordinates.
// The annotations never enter recognizeLocal; scoring happens after it returns.
for (const source of sources) {
  const fullPath = new URL(source.file, output);
  let original: Buffer;
  try {
    original = await readFile(fullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const { stdout } = await run("curl", ["-fLsS", "--max-time", "30", source.source_image],
      { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
    original = stdout;
    if (sha256(original) !== source.full_image_sha256)
      throw new Error(`${source.id}: source image changed; review it before replacing the annotation.`);
    await writeFile(fullPath, original);
  }
  if (sha256(original) !== source.full_image_sha256)
    throw new Error(`${source.id}: cached image does not match the reviewed source.`);
  const handImage = `${source.id}-hand.png`;
  const hand = await sharp(original).extract(source.crop).png().toBuffer();
  await writeFile(new URL(handImage, output), hand);
  const { data, info } = await sharp(hand).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const started = performance.now();
  let result, error = "";
  try {
    result = await recognizeLocal({ ...info, data });
  } catch (reason) {
    error = String(reason);
  }
  const recognized = result?.tiles ?? [];
  const countMatches = recognized.length === source.tiles.length;
  const exact = countMatches && recognized.every((tile, i) => tile === source.tiles[i]);
  results.push({
    ...source, hand_image: handImage, hand_image_sha256: sha256(hand),
    recognized, exact, count_matches: countMatches,
    unknown: recognized.filter((tile) => tile === null).length,
    boxes: result?.boxes ?? [], matches: result?.matches ?? [], error,
    milliseconds: Math.round(performance.now() - started),
  });
  console.log(`${source.id} [${source.split}] ${exact ? "PASS" : "REVIEW"} ${recognized.length}/${source.tiles.length}: ${recognized.map((tile) => tile ?? "?").join(" ")}${error}`);
}

const summary = ["tenhou", "majsoul"].map((platform) => {
  const subset = results.filter((result) => result.platform === platform && result.split === "validation");
  return {
    platform, samples: subset.length, exact: subset.filter((result) => result.exact).length,
    count_matches: subset.filter((result) => result.count_matches).length,
    expected_tiles: subset.reduce((sum, result) => sum + result.tiles.length, 0),
    recognized_tiles: subset.reduce((sum, result) => sum + result.recognized.length, 0),
    unknown: subset.reduce((sum, result) => sum + result.unknown, 0),
  };
});
await writeFile(new URL("results.json", output), JSON.stringify({
  description: "公开截图审视；输入为手工框选的一整行手牌。辅助样本不计入验证统计；牌数错误会使逐位比较错位，因此不报告总体逐张准确率。引擎及模板版本见 engine_sha256。",
  evaluated_at: new Date().toISOString(), engine_sha256: engineHashes, summary, results,
}, null, 2) + "\n");
console.table(summary);
