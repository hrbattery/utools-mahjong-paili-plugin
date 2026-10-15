import { ALL_TILES } from "./tiles.ts";
import type { Tile } from "./tiles.ts";

export type RecognizedHand = { tiles: (Tile | null)[]; notes: string };
export type AiModel = {
  id: string;
  label: string;
  vision?: boolean;
  cost?: number;
};
export type AiRequest = PromiseLike<{ content?: string }> & {
  abort?: () => void;
};
export interface UTools {
  allAiModels(): Promise<AiModel[]>;
  ai(options: {
    model: string;
    messages: { role: string; content: unknown }[];
  }): AiRequest;
  screenCapture(callback: (image: string) => void): void;
  onPluginEnter(
    callback: (action: { type: string; payload: string }) => void,
  ): void;
  shellOpenExternal(url: string): void;
  copyText(text: string): void;
}

declare global {
  interface Window {
    utools?: UTools;
  }
}

export const RECOGNITION_PROMPT = `你是日本麻将手牌图像转录器。只转录图中玩家自己的未固定手牌，按从左到右的原始顺序；包含右侧单独的摸牌。
不要包含牌河、宝牌指示牌、其他玩家的牌，也不要把吃碰杠固定面子混入手牌。
牌编码：1m-9m 万，1p-9p 筒，1s-9s 索，1z东 2z南 3z西 4z北 5z白 6z发 7z中。红五写0m/0p/0s。
特别检查白板、红五、重复牌和摸牌间隔。允许少于14张，不得为了凑14张补牌。看不清的牌位置必须填null，不能按牌理猜。
只输出JSON：{"tiles":["1m",null,"0p"],"notes":"不确定处的简短说明，没有则空字符串"}。不要计算向听数或提出打法。`;

/** Validate model output as untrusted data, preserving every uncertain tile position. */
export function parseRecognition(text: string): RecognizedHand {
  const content = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("模型没有返回有效 JSON，请重试或直接输入牌串。");
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("tiles" in value) ||
    !Array.isArray(value.tiles)
  ) {
    throw new Error("识别结果缺少逐张手牌列表。");
  }
  if (!value.tiles.length || value.tiles.length > 14)
    throw new Error("识别牌数不在 1–14 张内，请重新裁剪自己的手牌区域。");
  const valid = new Set([...ALL_TILES, "0m", "0p", "0s"]);
  if (
    value.tiles.some(
      (tile: unknown) =>
        tile !== null && (typeof tile !== "string" || !valid.has(tile)),
    )
  ) {
    throw new Error("模型返回了无效牌编码，请重试或使用牌串校正。");
  }
  return {
    tiles: value.tiles as (Tile | null)[],
    notes:
      "notes" in value && typeof value.notes === "string" ? value.notes : "",
  };
}
