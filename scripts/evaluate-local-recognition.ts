import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { recognizeLocal } from "../src/local-recognition.ts";

const root = new URL("../samples/private/", import.meta.url);
const results = [];

// Only image pixels enter the matcher; sample annotations are used afterward for scoring.
for (const platform of ["tenhou", "majsoul"]) {
  const directory = new URL(`${platform}/`, root);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
  for (const sample of manifest.samples) {
    const { data, info } = await sharp(new URL(sample.hand_image, directory).pathname)
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const started = performance.now();
    let recognized: (string | null)[] = [], error = "";
    try {
      recognized = (await recognizeLocal({ ...info, data })).tiles;
    } catch (reason) {
      error = String(reason);
    }
    const correct = recognized.filter((tile, i) => tile === sample.tiles[i]).length;
    results.push({
      id: sample.id, platform, split: sample.split, source_kind: sample.source_kind,
      expected: sample.tiles, recognized, error,
      exact: recognized.length === sample.tiles.length && correct === sample.tiles.length,
      correct, unknown: recognized.filter((tile) => tile === null).length,
      wrong: recognized.filter((tile, i) => tile !== null && tile !== sample.tiles[i]).length,
      milliseconds: Math.round(performance.now() - started),
    });
    console.log(`${sample.id} [${sample.split}] ${results.at(-1)!.exact ? "PASS" : "REVIEW"}: ${recognized.map((t) => t ?? "?").join(" ")}${error}`);
  }
}
await writeFile(new URL("local-recognition-results.json", root), JSON.stringify({
  description: "本地模板匹配，输入为已裁剪手牌。合成素材与模板同源，不代表真实截图准确率；不含自动整桌定位。",
  results,
}, null, 2) + "\n");
for (const platform of ["tenhou", "majsoul"]) {
  const subset = results.filter((result) => result.platform === platform);
  console.log(`${platform}: exact ${subset.filter((r) => r.exact).length}/${subset.length}, tiles ${subset.reduce((n, r) => n + r.correct, 0)}/${subset.reduce((n, r) => n + r.expected.length, 0)}, unknown ${subset.reduce((n, r) => n + r.unknown, 0)}, wrong ${subset.reduce((n, r) => n + r.wrong, 0)}`);
}
