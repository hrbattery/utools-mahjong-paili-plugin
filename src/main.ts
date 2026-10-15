import "./style.css";
import engineDataUrl from "./paili_engine.wasm?url&inline";
import {
  PALETTE,
  formatTiles,
  parseMelds,
  parseTiles,
  tileId,
  tileName,
  validateHand,
} from "./tiles.ts";
import type { Tile } from "./tiles.ts";
import { analyzeHand, loadEngine } from "./analysis.ts";
import type { Analysis } from "./analysis.ts";
import { parseRecognition, RECOGNITION_PROMPT } from "./recognition.ts";
import type { AiRequest } from "./recognition.ts";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const host = window.utools;
let engine: Awaited<ReturnType<typeof loadEngine>>;
let slots: (Tile | null)[] = [];
let selected = -1;
let discarded: Tile[] = [];
let history: { tiles: Tile[]; discarded: Tile[] }[] = [];
let inputError = "";
let handRevision = 0;
let imageRevision = 0;
let requestId = 0;
let activeRequest: AiRequest | undefined;
let result: Analysis | undefined;
let imageUrl = "";
let originalImageUrl = "";
let image = new Image();
let cropStart: [number, number] | undefined;
let cropEnd: [number, number] | undefined;
let modelsReady = false;

$("#app").innerHTML = `
  <main>
    <h1>牌理</h1>
    <section class="source-panel" aria-label="截图识牌">
      <div class="toolbar">
        <button id="choose-file">选择图片</button><button id="capture">框选截图</button><input id="file" type="file" accept="image/png,image/jpeg,image/webp" hidden/>
        <select id="model" aria-label="在线识牌模型" disabled><option>正在加载模型…</option></select><button id="refresh-models" title="刷新模型列表">刷新</button><button id="recognize" class="primary" disabled>识别手牌</button>
      </div>
      <div id="dropzone" class="dropzone"><div id="empty-image">拖入或粘贴雀魂 / 天凤截图</div><canvas id="preview" hidden aria-label="手牌截图，拖动框选裁剪区域"></canvas></div>
      <div class="toolbar crop-tools"><button id="crop" hidden>应用裁剪</button><button id="restore-image" hidden>还原图片</button></div>
      <p class="hint">点击识别会将当前图片发送给所选模型。</p><p id="recognition-status" role="status" class="status"></p>
    </section>
    <section class="hand-panel" aria-label="手牌编辑">
      <div class="section-head"><label for="hand-text">手牌</label><span id="tile-count" class="muted">0 张</span><div class="toolbar"><button id="sort">理牌</button><button id="clear">清空</button></div></div>
      <textarea id="hand-text" rows="1" spellcheck="false" placeholder="输入天凤牌串，如 123m245779p13555z"></textarea>
      <p class="hint">m 万 · p 筒 · s 索 · z 字（1–7：东南西北白发中）· 0 赤五</p>
      <div id="hand" class="hand" aria-label="当前手牌"></div>
      <details id="tile-editor"><summary>点选牌表</summary><div class="toolbar edit-tools"><span id="edit-mode" class="muted">点击牌表添加</span><button id="add-mode">添加</button><button id="delete-tile" disabled>删除选中</button></div><div id="palette" class="palette" aria-label="麻将牌表"></div></details>
      <details id="meld-details"><summary>已知吃碰杠（可选）</summary><label class="field-label" for="meld-text">每组用空格分隔，杠填写四张</label><input id="meld-text" spellcheck="false" placeholder="例如 123m 555p 7777z"/></details>
    </section>
    <section class="results-panel"><div class="section-head"><h2>进张</h2><div class="toolbar"><button id="undo" disabled>撤销推演</button><button id="tenhou" title="仅传递手牌，不含已知副露和推演弃牌" disabled>天凤查看</button><button id="copy" disabled>复制牌串</button></div></div>
      <p id="calculation-note" class="hint"></p><div id="analysis" aria-live="polite"></div>
      <p id="simulation" class="hint"></p>
    </section>
  </main>`;

/** Escape all dynamic text before inserting it into the HTML-based view. */
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

/** Render a tile as a readable button; all tile values are parser-validated. */
function tileButton(tile: Tile | null, attributes = ""): string {
  if (tile === null)
    return `<button class="tile unknown" ${attributes} aria-label="未识别牌，点击校正"><b>?</b><small>待校正</small></button>`;
  const suit = tile[1];
  const rank = tile[0] === "0" ? "5" : tile[0];
  const face = suit === "z" ? tileName(tile) : rank;
  const mark =
    suit === "z"
      ? ""
      : ({ m: "萬", p: "筒", s: "索" } as Record<string, string>)[suit];
  return `<button class="tile ${suit} ${tile[0] === "0" ? "red" : ""}" ${attributes} aria-label="${tileName(tile)} (${tile})" title="${tileName(tile)} · ${tile}"><b>${face}</b><span>${mark}</span><small>${tile}</small></button>`;
}

/** Keep uncertain positions in the text preview without inventing a tile value. */
function draftText(): string {
  return slots.map((tile) => tile ?? "?").join(" ");
}

/** Synchronize point edits back to the text field and reset any old analysis branch. */
function syncHand(resetHistory = true): void {
  $<HTMLTextAreaElement>("#hand-text").value = slots.includes(null)
    ? draftText()
    : formatTiles(slots as Tile[]);
  inputError = "";
  handRevision++;
  if (resetHistory) {
    history = [];
    discarded = [];
  }
  renderHand();
  renderAnalysis();
}

/** Render current slots and the editor selection without changing the typed text. */
function renderHand(): void {
  $("#tile-count").textContent = `${slots.length} 张`;
  $("#hand").innerHTML = slots.length
    ? slots
        .map((tile, index) =>
          tileButton(
            tile,
            `data-index="${index}" aria-pressed="${selected === index}"`,
          ),
        )
        .join("")
    : "";
  $("#edit-mode").textContent =
    selected < 0 ? "点击牌表添加" : `替换第 ${selected + 1} 张`;
  $<HTMLButtonElement>("#delete-tile").disabled = selected < 0;
  $<HTMLButtonElement>("#undo").disabled = history.length === 0;
}

/** Convert engine states to display text, keeping exhausted completion distinct. */
function shantenText(value: number): string {
  return value === -1
    ? "和牌形"
    : value === 0
      ? "听牌"
      : Number.isFinite(value)
        ? `${value} 向听`
        : "无可达和牌形";
}

/** Recalculate from the current text/tiles; never show old results after invalid input. */
function renderAnalysis(): void {
  result = undefined;
  $("#calculation-note").textContent = "";
  $<HTMLButtonElement>("#tenhou").disabled = true;
  $<HTMLButtonElement>("#copy").disabled = true;
  $("#simulation").textContent = discarded.length
    ? `推演中已弃：${formatTiles(discarded)}（仍从剩余牌中扣除）`
    : "";
  try {
    if (inputError) throw new Error(inputError);
    if (!slots.length) {
      $("#analysis").innerHTML =
        '<div class="empty-result">输入手牌后显示进张结果。</div>';
      return;
    }
    if (slots.includes(null))
      throw new Error("存在未识别牌，请点击 ? 校正，或直接改写完整牌串。");
    const tiles = slots as Tile[];
    const melds = parseMelds($<HTMLInputElement>("#meld-text").value);
    validateHand(tiles, melds, discarded);
    if (!engine) {
      $("#analysis").textContent = "正在加载本地计算引擎…";
      return;
    }
    result = analyzeHand(engine, tiles, melds, discarded);
    const missing = 4 - Math.floor(tiles.length / 3) - melds.length;
    $("#calculation-note").textContent =
      `${melds.length ? "已扣除填入的吃碰杠" : "仅按手牌扣减"}${missing ? `；还有 ${missing} 组固定面子未提供` : ""}。${discarded.length ? "已扣除模拟弃牌。" : ""}理论未见枚数，不代表实际牌山余量。`;
    $<HTMLButtonElement>("#tenhou").disabled = false;
    $<HTMLButtonElement>("#copy").disabled = false;
    const metrics = `<div class="metrics"><strong>${shantenText(result.shanten)}</strong><span>${result.mode === "discard" ? "点击切牌继续推演" : "点击有效牌继续推演"}</span></div>`;
    const rows = result.rows
      .map(
        (row, index) =>
          `<tr><td>${row.discard ? `<div class="discard-cell"><span>切</span>${tileButton(row.discard, `data-discard="${index}"`)}</div>` : "有效进张"}</td><td>${shantenText(row.shanten)}</td><td class="number">${row.waits.length}<small> 种</small> / ${row.total}<small> 枚</small></td><td><div class="waits">${row.waits.map((wait) => `<div>${tileButton(wait.tile, result!.mode === "draw" ? `data-draw="${wait.tile}"` : "disabled")}<small>×${wait.remaining}</small></div>`).join("") || '<span class="muted">无有效进张</span>'}</div></td></tr>`,
      )
      .join("");
    $("#analysis").innerHTML =
      metrics +
      (result.shanten === -1
        ? '<div class="complete">已组成和牌形，仅判断牌形。</div>'
        : `<div class="table-wrap"><table><thead><tr><th>切牌</th><th>切后状态</th><th>有效进张</th><th>牌种与剩余枚数</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  } catch (error) {
    $("#analysis").innerHTML =
      `<div class="input-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}

/** Redraw the source image and an optional crop overlay using image pixel coordinates. */
function paintImage(): void {
  const canvas = $<HTMLCanvasElement>("#preview");
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  if (cropStart && cropEnd) {
    context.strokeStyle = "#eaa967";
    context.lineWidth = Math.max(2, canvas.width / 400);
    context.fillStyle = "#eaa96733";
    context.fillRect(
      cropStart[0],
      cropStart[1],
      cropEnd[0] - cropStart[0],
      cropEnd[1] - cropStart[1],
    );
    context.strokeRect(
      cropStart[0],
      cropStart[1],
      cropEnd[0] - cropStart[0],
      cropEnd[1] - cropStart[1],
    );
  }
}

/** Cancel pending recognition when the source changes, preserving manual hand edits. */
async function setImage(url: string, original = true): Promise<void> {
  const revision = ++imageRevision;
  requestId++;
  activeRequest?.abort?.();
  activeRequest = undefined;
  const nextImage = new Image();
  nextImage.src = url;
  await nextImage.decode();
  if (revision !== imageRevision) return;
  image = nextImage;
  imageUrl = url;
  if (original) originalImageUrl = url;
  cropStart = cropEnd = undefined;
  const canvas = $<HTMLCanvasElement>("#preview");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.hidden = false;
  $("#empty-image").hidden = true;
  $("#crop").hidden = true;
  $("#restore-image").hidden = url === originalImageUrl;
  $("#recognition-status").textContent =
    "图片已就绪。可拖动框选手牌区域，再点击识别。";
  $<HTMLButtonElement>("#recognize").disabled = !modelsReady;
  paintImage();
}

/** Decode a chosen or pasted image; invalid files leave the previous hand untouched. */
async function readImage(file: File): Promise<void> {
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("无法读取图片。"));
      reader.readAsDataURL(file);
    });
    await setImage(url);
  } catch (error) {
    $("#recognition-status").textContent = String(error);
  }
}

/** Discover vision models from the actual uTools host; browser preview stays manual. */
async function loadModels(): Promise<void> {
  const select = $<HTMLSelectElement>("#model");
  modelsReady = false;
  select.disabled = true;
  $<HTMLButtonElement>("#recognize").disabled = true;
  if (!host?.allAiModels || !host.ai) {
    select.innerHTML = "<option>请在 uTools 8 中使用在线识牌</option>";
    return;
  }
  try {
    const models = (await host.allAiModels()).filter((model) => model.vision);
    modelsReady = models.length > 0;
    select.innerHTML = models.length
      ? models
          .map(
            (model) =>
              `<option value="${escapeHtml(model.id)}">${escapeHtml(model.label)}${model.cost === undefined ? "" : ` · ${model.cost} 能量/次`}</option>`,
          )
          .join("")
      : "<option>未找到视觉模型，请在 uTools 配置</option>";
    select.disabled = !modelsReady;
    $<HTMLButtonElement>("#recognize").disabled = !modelsReady || !imageUrl;
  } catch (error) {
    select.innerHTML = "<option>模型列表获取失败</option>";
    $("#recognition-status").textContent = String(error);
  }
}

/** Recognize once, then ignore any response superseded by a new image or manual edit. */
async function recognize(): Promise<void> {
  if (!host || !modelsReady || !imageUrl) return;
  const id = ++requestId;
  const revision = handRevision;
  const started = performance.now();
  $<HTMLButtonElement>("#recognize").disabled = true;
  $("#recognition-status").textContent = "正在识别…";
  try {
    activeRequest = host.ai({
      model: $<HTMLSelectElement>("#model").value,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: RECOGNITION_PROMPT },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });
    const response = await activeRequest;
    if (id !== requestId) return;
    if (revision !== handRevision) {
      $("#recognition-status").textContent =
        "识别期间手牌已被编辑，未覆盖你的修改。";
      return;
    }
    const parsed = parseRecognition(response.content ?? "");
    slots = parsed.tiles;
    selected = -1;
    $<HTMLInputElement>("#meld-text").value = "";
    syncHand();
    $("#recognition-status").textContent =
      `识别用时 ${((performance.now() - started) / 1000).toFixed(1)} 秒。请对照原图确认。${parsed.notes}`;
  } catch (error) {
    if (id === requestId)
      $("#recognition-status").textContent =
        `识别未完成：${error instanceof Error ? error.message : String(error)} 可以继续手动输入。`;
  } finally {
    if (id === requestId) {
      activeRequest = undefined;
      $<HTMLButtonElement>("#recognize").disabled = false;
    }
  }
}

/** Apply a simulated discard/draw while retaining previously known discarded copies. */
function simulate(discardIndex?: number, draw?: Tile): void {
  if (!result || slots.includes(null)) return;
  history.push({ tiles: [...slots] as Tile[], discarded: [...discarded] });
  if (discardIndex !== undefined) {
    const discard = result.rows[discardIndex].discard!;
    slots.splice(slots.indexOf(discard), 1);
    discarded.push(discard);
  } else if (draw) slots.push(draw);
  selected = -1;
  syncHand(false);
}

$<HTMLButtonElement>("#capture").disabled = !host?.screenCapture;
$("#palette").innerHTML = ["m", "p", "s", "z"]
  .map(
    (suit) =>
      `<div>${PALETTE.filter((tile) => tile[1] === suit)
        .map((tile) => tileButton(tile, `data-pick="${tile}"`))
        .join("")}</div>`,
  )
  .join("");
$("#hand-text").addEventListener("input", () => {
  handRevision++;
  history = [];
  discarded = [];
  selected = -1;
  try {
    slots = parseTiles($<HTMLTextAreaElement>("#hand-text").value);
    inputError = "";
  } catch (error) {
    slots = [];
    inputError = (error as Error).message;
  }
  renderHand();
  renderAnalysis();
});
$("#meld-text").addEventListener("input", () => {
  handRevision++;
  history = [];
  discarded = [];
  renderHand();
  renderAnalysis();
});
$("#hand").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-index]",
  );
  if (button) {
    selected = Number(button.dataset.index);
    $<HTMLDetailsElement>("#tile-editor").open = true;
    renderHand();
  }
});
$("#palette").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-pick]",
  );
  if (!button) return;
  if (selected < 0 && slots.length >= 14) return;
  if (selected < 0) slots.push(button.dataset.pick!);
  else slots[selected] = button.dataset.pick!;
  selected = -1;
  syncHand();
});
$("#add-mode").onclick = () => {
  selected = -1;
  renderHand();
};
$("#delete-tile").onclick = () => {
  if (selected >= 0) {
    slots.splice(selected, 1);
    selected = -1;
    syncHand();
  }
};
$("#sort").onclick = () => {
  slots.sort((a, b) =>
    a === null ? 1 : b === null ? -1 : tileId(a) - tileId(b),
  );
  selected = -1;
  syncHand(false);
};
$("#clear").onclick = () => {
  slots = [];
  selected = -1;
  $<HTMLInputElement>("#meld-text").value = "";
  syncHand();
};
$("#analysis").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-discard],[data-draw]",
  );
  if (button?.dataset.discard !== undefined)
    simulate(Number(button.dataset.discard));
  else if (button?.dataset.draw) simulate(undefined, button.dataset.draw);
});
$("#undo").onclick = () => {
  const previous = history.pop();
  if (previous) {
    slots = previous.tiles;
    discarded = previous.discarded;
    selected = -1;
    syncHand(false);
  }
};
$("#tenhou").onclick = () => {
  const url = `https://tenhou.net/2/?q=${encodeURIComponent(formatTiles(slots as Tile[]))}`;
  if (host) host.shellOpenExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
};
$("#copy").onclick = async () => {
  const text = formatTiles(slots as Tile[]);
  if (host) host.copyText(text);
  else await navigator.clipboard.writeText(text);
};
$("#choose-file").onclick = () => $<HTMLInputElement>("#file").click();
$("#file").onchange = () => {
  const file = $<HTMLInputElement>("#file").files?.[0];
  if (file) void readImage(file);
  $<HTMLInputElement>("#file").value = "";
};
$("#capture").onclick = () =>
  host?.screenCapture((url) => {
    if (url)
      void setImage(url).catch((error) => {
        $("#recognition-status").textContent = String(error);
      });
  });
$("#recognize").onclick = () => void recognize();
$("#refresh-models").onclick = () => void loadModels();
$("#restore-image").onclick = () => void setImage(originalImageUrl, false);
$("#dropzone").ondragover = (event) => {
  event.preventDefault();
};
$("#dropzone").ondrop = (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) void readImage(file);
};
document.addEventListener("paste", (event) => {
  const file = [...(event.clipboardData?.items ?? [])]
    .find((item) => item.type.startsWith("image/"))
    ?.getAsFile();
  if (file) {
    event.preventDefault();
    void readImage(file);
  }
});

/** Convert pointer position to original pixels, respecting scaled preview dimensions. */
function imagePoint(event: PointerEvent): [number, number] {
  const canvas = $<HTMLCanvasElement>("#preview");
  const rect = canvas.getBoundingClientRect();
  return [
    Math.max(
      0,
      Math.min(
        canvas.width,
        ((event.clientX - rect.left) / rect.width) * canvas.width,
      ),
    ),
    Math.max(
      0,
      Math.min(
        canvas.height,
        ((event.clientY - rect.top) / rect.height) * canvas.height,
      ),
    ),
  ];
}
const canvas = $<HTMLCanvasElement>("#preview");
canvas.onpointerdown = (event) => {
  cropStart = imagePoint(event);
  cropEnd = undefined;
  canvas.setPointerCapture(event.pointerId);
};
canvas.onpointermove = (event) => {
  if (canvas.hasPointerCapture(event.pointerId)) {
    cropEnd = imagePoint(event);
    paintImage();
  }
};
canvas.onpointerup = (event) => {
  cropEnd = imagePoint(event);
  canvas.releasePointerCapture(event.pointerId);
  $("#crop").hidden =
    !cropStart ||
    Math.abs(cropEnd[0] - cropStart[0]) < 5 ||
    Math.abs(cropEnd[1] - cropStart[1]) < 5;
  paintImage();
};
$("#crop").onclick = () => {
  if (!cropStart || !cropEnd) return;
  const cropped = document.createElement("canvas");
  cropped.width = Math.round(Math.abs(cropEnd[0] - cropStart[0]));
  cropped.height = Math.round(Math.abs(cropEnd[1] - cropStart[1]));
  cropped
    .getContext("2d")!
    .drawImage(
      image,
      Math.min(cropStart[0], cropEnd[0]),
      Math.min(cropStart[1], cropEnd[1]),
      cropped.width,
      cropped.height,
      0,
      0,
      cropped.width,
      cropped.height,
    );
  void setImage(cropped.toDataURL("image/png"), false);
};

host?.onPluginEnter(({ type, payload }) => {
  if (type === "img")
    void setImage(payload).catch((error) => {
      $("#recognition-status").textContent = String(error);
    });
  if (type === "regex") {
    $<HTMLTextAreaElement>("#hand-text").value = payload;
    $("#hand-text").dispatchEvent(new Event("input"));
  }
});
void loadModels();
// Inline bytes also work under the uTools file protocol, without fetch(file://...).
const engineBytes = Uint8Array.from(atob(engineDataUrl.split(",")[1]), (char) =>
  char.charCodeAt(0),
);
void loadEngine(engineBytes)
  .then((loaded) => {
    engine = loaded;
    renderAnalysis();
  })
  .catch((error) => {
    $("#analysis").textContent = String(error);
  });
