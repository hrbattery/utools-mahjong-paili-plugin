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
import { recognizeLocal } from "./local-recognition.ts";
import type { Box } from "./tile-matching.ts";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const host = window.utools;
let engine: Awaited<ReturnType<typeof loadEngine>>;
let slots: (Tile | null)[] = [];
let selected = -1;
let autoSort = true;
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
let recognizing = false;
let imageLoading = false;
let matchedBoxes: { box: Box; uncertain: boolean }[] = [];
let copyToastTimer: number | undefined;

$("#app").innerHTML = `
  <main>
    <header class="page-head"><h1>日麻牌理</h1><p class="hint">直接粘贴截图，自动识牌并计算进张</p></header>
    <p id="recognition-status" role="status" class="status"></p>
    <section class="hand-overview" aria-label="手牌校正">
      <div class="section-head"><h2>手牌</h2><span id="tile-count" class="muted">0 张</span><div class="toolbar"><button id="auto-sort" aria-pressed="true">自动理牌：开</button><button id="clear">清空</button></div></div>
      <div id="hand" class="hand" aria-label="当前手牌"></div>
    </section>
    <div class="workspace">
      <section class="results-panel" aria-label="进张分析"><div class="section-head"><h2>进张</h2><div class="toolbar"><button id="undo" disabled>撤销推演</button><button id="tenhou" title="仅传递手牌，不含已知副露和推演弃牌" disabled>跳转天凤牌理</button><button id="copy" disabled>复制牌串</button></div></div>
        <p id="calculation-note" class="hint"></p><div id="analysis" aria-live="polite"></div>
        <p id="simulation" class="hint"></p>
      </section>
      <aside class="editor-panel" aria-label="手牌与图片工具">
        <section class="hand-panel" aria-label="手牌编辑">
          <div class="section-head"><label for="hand-text">手牌牌串</label></div>
          <textarea id="hand-text" rows="1" spellcheck="false" placeholder="输入天凤牌串，如 123m245779p13555z"></textarea>
          <p class="hint">m 万 · p 筒 · s 索 · z 字（1–7：东南西北白发中）· 0 赤五</p>
          <details id="tile-editor"><summary>点选牌表</summary><div class="toolbar edit-tools"><span id="edit-mode" class="muted">点击牌表添加</span><button id="add-mode">添加</button><button id="delete-tile" disabled>删除选中</button></div><div id="palette" class="palette" aria-label="麻将牌表"></div></details>
          <details id="meld-details"><summary>已知吃碰杠（可选）</summary><label class="field-label" for="meld-text">每组用空格分隔，杠填写四张</label><input id="meld-text" spellcheck="false" placeholder="例如 123m 555p 7777z"/></details>
        </section>
        <section class="source-panel" aria-label="截图识牌">
          <details id="image-tools"><summary>图片与识牌工具</summary>
            <div class="toolbar">
              <button id="choose-file">选择图片</button><button id="capture">框选截图</button><input id="file" type="file" accept="image/png,image/jpeg,image/webp" hidden/>
              <button id="recognize-local" disabled>本地识牌</button><select id="model" aria-label="在线识牌模型" hidden disabled><option>正在加载模型…</option></select><button id="refresh-models" title="刷新模型列表" hidden>刷新</button><button id="recognize" hidden disabled>在线识牌</button>
            </div>
            <div id="dropzone" class="dropzone"><div id="empty-image">拖入雀魂 / 天凤截图</div><canvas id="preview" hidden aria-label="手牌截图，拖动框选裁剪区域"></canvas></div>
            <div class="toolbar crop-tools"><button id="crop" hidden>应用裁剪</button><button id="restore-image" hidden>还原图片</button></div>
            <p class="hint">支持雀魂和天凤标准游戏截图。图片仅在本地识别。若识别不完整，可手动选择增减替换手牌。</p>
          </details>
        </section>
      </aside>
    </div>
  </main>
  <div id="copy-toast" class="toast" role="status" hidden></div>`;

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

/** Render a local SVG face while retaining accessible names and the existing button actions. */
function tileButton(tile: Tile | null, attributes = ""): string {
  if (tile === null)
    return `<button class="tile unknown" ${attributes} aria-label="未识别牌，点击校正"><b>?</b><small>待校正</small></button>`;
  return `<button class="tile" ${attributes} aria-label="${tileName(tile)} (${tile})" title="${tileName(tile)} · ${tile}"><img src="./tiles/mahjong-graphic/${tile}.svg" alt="" draggable="false"/></button>`;
}

/** Keep uncertain positions in the text preview without inventing a tile value. */
function draftText(): string {
  return slots.map((tile) => tile ?? "?").join(" ");
}

/** Sort and synchronize edits, matching repeated tiles by their original slot for a brief slide. */
function syncHand(resetHistory = true): void {
  const order = autoSort
    ? slots.map((tile, index) => ({ tile, index })).sort((a, b) =>
      a.tile === null ? 1 : b.tile === null ? -1 : tileId(a.tile) - tileId(b.tile),
    )
    : undefined;
  const positions: DOMRect[] = [];
  if (order?.some((entry, index) => entry.index !== index) &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Measure the edited hand before sorting so new and repeated tiles keep their own origin.
    renderHand();
    positions.push(...Array.from($("#hand").children, (tile) => tile.getBoundingClientRect()));
  }
  if (order) slots = order.map((entry) => entry.tile);
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
  const tiles = $("#hand").children;
  order?.forEach((entry, index) => {
    const previous = positions[entry.index];
    if (!previous) return;
    const tile = tiles[index];
    const current = tile.getBoundingClientRect();
    const x = previous.left - current.left;
    const y = previous.top - current.top;
    if (x || y) tile.animate([
      { transform: `translate(${x}px, ${y}px)` },
      { transform: "translate(0, 0)" },
    ], { duration: 160, easing: "ease-out" });
  });
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
        '<div class="empty-result">粘贴截图或输入手牌后显示进张结果。</div>';
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
  for (const { box, uncertain } of matchedBoxes) {
    context.strokeStyle = uncertain ? "#bd7017" : "#237f69";
    context.lineWidth = Math.max(1, canvas.width / 600);
    context.strokeRect(box.left, box.top, box.width, box.height);
  }
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

/** Load the latest image, optionally recognizing a paste without overwriting intervening edits. */
async function setImage(source: string | File, original = true, autoRecognize = false): Promise<void> {
  const revision = ++imageRevision;
  const handBeforeLoad = handRevision;
  requestId++;
  recognizing = false;
  imageLoading = true;
  matchedBoxes = [];
  updateRecognitionButtons();
  activeRequest?.abort?.();
  activeRequest = undefined;
  $("#recognition-status").textContent = "正在读取图片…";
  try {
    // Reserve the revision before FileReader starts so a slow earlier paste cannot win.
    const url = typeof source === "string" ? source : await readImage(source);
    if (revision !== imageRevision) return;
    const nextImage = new Image();
    nextImage.src = url;
    await nextImage.decode();
    if (revision !== imageRevision) return;
    imageLoading = false;
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
    updateRecognitionButtons();
    paintImage();
    if (autoRecognize) {
      if (handBeforeLoad !== handRevision) {
        $("#recognition-status").textContent = "图片加载期间手牌已被编辑，未覆盖你的修改。可点击本地识牌重新识别。";
        return;
      }
      await recognize(true);
    }
  } catch (error) {
    if (revision === imageRevision) {
      imageLoading = false;
      updateRecognitionButtons();
      $("#recognition-status").textContent = `图片加载失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

/** Read a supported image file as a data URL for the shared loading path. */
async function readImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取图片。"));
    reader.readAsDataURL(file);
  });
}

/** Keep local recognition available without an online model or uTools host. */
function updateRecognitionButtons(): void {
  $<HTMLButtonElement>("#recognize-local").disabled = recognizing || imageLoading || !imageUrl;
  $<HTMLButtonElement>("#recognize").disabled = recognizing || imageLoading || !imageUrl || !modelsReady;
}

/** Discover vision models from the actual uTools host independently of local recognition. */
async function loadModels(): Promise<void> {
  const select = $<HTMLSelectElement>("#model");
  modelsReady = false;
  select.disabled = true;
  updateRecognitionButtons();
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
    updateRecognitionButtons();
  } catch (error) {
    select.innerHTML = "<option>模型列表获取失败</option>";
    $("#recognition-status").textContent = String(error);
  }
}

/** Recognize once, then ignore any response superseded by a new image or manual edit. */
async function recognize(local = false): Promise<void> {
  if (recognizing || imageLoading || !imageUrl || (!local && (!host || !modelsReady))) return;
  const id = ++requestId;
  const revision = handRevision;
  const started = performance.now();
  recognizing = true;
  matchedBoxes = [];
  paintImage();
  updateRecognitionButtons();
  $("#recognition-status").textContent = local ? "正在本地匹配牌面…" : "正在在线识别…";
  try {
    let parsed;
    if (local) {
      const pixels = document.createElement("canvas");
      // Bounding the working image limits memory and keeps large screenshots responsive.
      const scale = Math.min(1, 1800 / image.naturalWidth, 600 / image.naturalHeight);
      pixels.width = Math.max(1, Math.round(image.naturalWidth * scale));
      pixels.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = pixels.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(image, 0, 0, pixels.width, pixels.height);
      const localResult = await recognizeLocal(context.getImageData(0, 0, pixels.width, pixels.height), () => id !== requestId || revision !== handRevision);
      if (id === requestId && revision === handRevision) {
        matchedBoxes = localResult.boxes.map((box, index) => ({
          box: { left: box.left / scale, top: box.top / scale, width: box.width / scale, height: box.height / scale },
          uncertain: localResult.tiles[index] === null,
        }));
        paintImage();
      }
      parsed = localResult;
    } else {
      activeRequest = host!.ai({
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
      parsed = parseRecognition(response.content ?? "");
    }
    if (id !== requestId) return;
    if (revision !== handRevision) {
      $("#recognition-status").textContent =
        "识别期间手牌已被编辑，未覆盖你的修改。";
      return;
    }
    slots = parsed.tiles;
    selected = -1;
    $<HTMLInputElement>("#meld-text").value = "";
    syncHand();
    $("#recognition-status").textContent =
      `识别用时 ${((performance.now() - started) / 1000).toFixed(1)} 秒。请对照原图确认。${parsed.notes}`;
  } catch (error) {
    if (id === requestId)
      $("#recognition-status").textContent =
        revision !== handRevision ? "识别期间手牌已被编辑，未覆盖你的修改。" :
        `识别未完成：${error instanceof Error ? error.message : String(error)} 可以继续手动输入。`;
  } finally {
    if (id === requestId) {
      activeRequest = undefined;
      recognizing = false;
      updateRecognitionButtons();
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
// Commit sorting after text editing ends so typing does not move the caret.
$("#hand-text").addEventListener("change", () => {
  if (autoSort && !inputError)
    syncHand(false);
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
$("#auto-sort").onclick = () => {
  autoSort = !autoSort;
  $("#auto-sort").setAttribute("aria-pressed", String(autoSort));
  $("#auto-sort").textContent = `自动理牌：${autoSort ? "开" : "关"}`;
  if (autoSort && !inputError && slots.length) {
    selected = -1;
    syncHand(false);
  }
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
/** Report the clipboard result briefly, restarting the toast duration on each copy. */
$("#copy").onclick = async () => {
  const toast = $("#copy-toast");
  try {
    const text = formatTiles(slots as Tile[]);
    if (host) host.copyText(text);
    else await navigator.clipboard.writeText(text);
    toast.textContent = "牌串已复制";
  } catch {
    toast.textContent = "复制失败，请重试。";
  }
  window.clearTimeout(copyToastTimer);
  toast.hidden = false;
  copyToastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2000);
};
$("#choose-file").onclick = () => $<HTMLInputElement>("#file").click();
$("#file").onchange = () => {
  const file = $<HTMLInputElement>("#file").files?.[0];
  if (file) void setImage(file);
  $<HTMLInputElement>("#file").value = "";
};
$("#capture").onclick = () =>
  host?.screenCapture((url) => {
    if (url) void setImage(url);
  });
$("#recognize").onclick = () => void recognize();
$("#recognize-local").onclick = () => void recognize(true);
$("#refresh-models").onclick = () => void loadModels();
$("#restore-image").onclick = () => void setImage(originalImageUrl, false);
$("#dropzone").ondragover = (event) => {
  event.preventDefault();
};
$("#dropzone").ondrop = (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) void setImage(file);
};
document.addEventListener("paste", (event) => {
  const file = [...(event.clipboardData?.items ?? [])]
    .find((item) => item.type.startsWith("image/"))
    ?.getAsFile();
  if (file) {
    event.preventDefault();
    void setImage(file, true, true);
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
    void setImage(payload, true, true);
  if (type === "regex") {
    $<HTMLTextAreaElement>("#hand-text").value = payload;
    $("#hand-text").dispatchEvent(new Event("input"));
    $("#hand-text").dispatchEvent(new Event("change"));
  }
});
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
