// reader/site/api.js
// Static-site adapter. No backend: talks to the cent provider straight from
// the browser, caches scripts and edits in localStorage. CORS is open on the API.

import { chunkText, countWords, stripMarkup, pauseFor } from "./chunk.js";

const CACHE_VERSION = 2;
const CACHE_TAG = `v${CACHE_VERSION}`;
const DEFAULT_BASE = "https://api.cent-ai.dev/v1";
const DEFAULT_MODEL = "hy4-flash:free";
const SCRIPTS_KEY = "readslow.scripts";
const EDITS_KEY = "readslow.edits";
const CONFIG_KEY = "readslow.config";
const KEY_KEY = "readslow.key";

const store = globalThis.localStorage || (() => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
})();

let readingSkill = "";
let editingSkill = "";

export function getConfig() {
  let config = {};
  try { config = JSON.parse(store.getItem(CONFIG_KEY) || "{}"); } catch { /* noop */ }
  return {
    baseURL: config.baseURL || DEFAULT_BASE,
    model: config.model || DEFAULT_MODEL,
    apiKey: store.getItem(KEY_KEY) || "",
  };
}

export function setConfig({ apiKey, baseURL, model }) {
  if (typeof apiKey === "string") store.setItem(KEY_KEY, apiKey.trim());
  const config = getConfig();
  const next = {
    baseURL: baseURL || config.baseURL,
    model: model || config.model,
  };
  store.setItem(CONFIG_KEY, JSON.stringify(next));
}

export async function health() {
  const config = getConfig();
  return {
    ok: true,
    ai: Boolean(config.apiKey),
    provider: "cent-ai",
    model: config.model,
    keySource: config.apiKey ? "browser" : "none",
  };
}

function loadMap(key) {
  try { return JSON.parse(store.getItem(key) || "{}"); } catch { return {}; }
}

function saveMap(key, map) {
  const keys = Object.keys(map);
  if (keys.length > 30) delete map[keys[0]];
  store.setItem(key, JSON.stringify(map));
}

function hashId(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function fetchSkill(which) {
  if (which === "edit") {
    if (!editingSkill) editingSkill = await (await fetch("./skill/editing-skill.md")).text();
    return editingSkill;
  }
  if (!readingSkill) readingSkill = await (await fetch("./skill/reading-skill.md")).text();
  return readingSkill;
}

function parseJsonLoose(content) {
  let text = String(content ?? "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("model returned no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

async function postCompletion(messages, { maxTokens = 2400, temperature = 0.2, raw = false } = {}) {
  const config = getConfig();
  if (!config.apiKey) throw new Error("add your cent key with the key button first");

  const response = await fetch(`${config.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`provider ${response.status}: ${detail.slice(0, 120)}`);
  }

  const data = await response.json();
  const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
  if (!content) throw new Error("model returned empty content");
  return raw ? content : parseJsonLoose(content);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizeEmphasis(rawList, text) {
  const words = text.split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ""));
  const out = [];
  for (const raw of rawList) {
    const target = String(raw).toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
    if (!target) continue;
    const exact = words.find((word) => word.toLowerCase() === target);
    if (exact) { out.push(exact); continue; }
    for (let i = 0; i < words.length; i += 1) {
      let acc = "";
      for (let j = i; j < words.length; j += 1) {
        acc += words[j].toLowerCase();
        if (acc === target) { out.push(words[i]); i = words.length; break; }
        if (!target.startsWith(acc)) break;
      }
    }
  }
  return [...new Set(out)].slice(0, 3);
}

function sanitizeChunks(payload) {
  const list = Array.isArray(payload?.chunks) ? payload.chunks : [];
  const out = [];
  for (const item of list) {
    if (!item) continue;
    const text = String(item.text ?? item.chunk ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const pauseMs = clamp(Math.round(Number(item.pauseMs ?? item.pause ?? 300) || 0), 0, 1500);
    const emphasis = normalizeEmphasis(Array.isArray(item.emphasis) ? item.emphasis : [], text);
    const cue = item.cue === "new line" ? "new line" : "";

    if (countWords(text) > 14) {
      const pieces = chunkText(text, { maxWords: 12 }).chunks;
      pieces.forEach((piece, index) => out.push({
        text: piece.text,
        pauseMs: index === pieces.length - 1 ? pauseMs : piece.pauseMs,
        emphasis: index === pieces.length - 1 ? emphasis : [],
        cue: index === 0 ? cue : "",
      }));
      continue;
    }
    out.push({ text, pauseMs, emphasis, cue });
  }
  return out;
}

function makeBatches(text, limit) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const batches = [];
  let current = "";
  const flush = () => { if (current.trim()) batches.push(current.trim()); current = ""; };

  for (const paragraph of paragraphs) {
    const pieces = paragraph.length <= limit
      ? [paragraph]
      : chunkText(paragraph).chunks.map((chunk) => chunk.text);
    if (!current) current = pieces[0];
    else if (current.length + pieces[0].length + 2 <= limit) current += `\n\n${pieces[0]}`;
    else { flush(); current = pieces[0]; }
    for (const piece of pieces.slice(1)) {
      if (current.length + piece.length + 1 <= limit) current += `\n${piece}`;
      else { flush(); current = piece; }
    }
  }
  flush();
  return batches;
}

async function pool(items, worker, limit) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function guessTitle(text) {
  const words = (text.split(/\n{2,}/)[0] || "").replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .trim().split(/\s+/).filter(Boolean);
  const title = words.slice(0, 7).join(" ");
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : "Untitled";
}

function renumber(chunks) {
  let paragraph = 0;
  const original = chunks.map((chunk) => chunk.para);
  chunks.forEach((chunk, index) => {
    const explicit = Number.isFinite(chunk.para) && Number.isFinite(original[index - 1])
      && chunk.para !== original[index - 1];
    if (index > 0 && (chunk.cue === "new line" || explicit)) paragraph += 1;
    chunk.para = paragraph;
  });
}

export async function prep(rawText, style = "study") {
  const clean = stripMarkup(rawText);
  if (!clean) throw new Error("nothing to read after cleanup");
  const capped = clean.slice(0, 60_000);
  const id = hashId(`${CACHE_TAG}|${style}|${capped}`);
  const cache = loadMap(SCRIPTS_KEY);
  if (cache[id]) return { ...cache[id], meta: { ...cache[id].meta, cached: true } };

  if (!getConfig().apiKey) {
    const chunks = chunkText(capped).chunks;
    return {
      id, title: guessTitle(clean), style, model: "local",
      created: new Date().toISOString(), source: capped,
      words: countWords(capped), chunks,
      meta: { source: "local", batches: 0, failedBatches: 0, tailChunks: 0, ms: 0 },
    };
  }

  const started = Date.now();
  const skill = await fetchSkill("reading");
  const batches = makeBatches(capped, 1300);
  const aiBatches = batches.slice(0, 48);
  const tailText = batches.slice(48).join("\n\n");

  const results = await pool(aiBatches, async (batch, index) => {
    try {
      const json = await postCompletion([
        { role: "system", content: skill },
        {
          role: "user",
          content: [
            `STYLE: ${style}`,
            index === 0
              ? 'Give a short title (2-6 words). Set "title": null in other batches.'
              : 'Set "title": null.',
            "TEXT:",
            batch,
          ].join("\n"),
        },
      ], { maxTokens: 2400 });
      const chunks = sanitizeChunks(json);
      if (!chunks.length) throw new Error("no phrases returned");
      if (chunks.reduce((sum, c) => sum + countWords(c.text), 0) < countWords(batch) * 0.65) {
        throw new Error("model dropped content");
      }
      return { ok: true, chunks, title: typeof json.title === "string" ? json.title.slice(0, 90) : null };
    } catch {
      return { ok: false, chunks: chunkText(batch).chunks, title: null };
    }
  }, 4);

  const merged = [];
  let failed = 0;
  let title = "";
  for (const result of results) {
    if (!result.ok) failed += 1;
    if (!title && result.title) title = result.title;
    merged.push(...result.chunks);
  }
  if (tailText.trim()) merged.push(...chunkText(tailText).chunks);

  renumber(merged);

  const script = {
    id,
    title: title || guessTitle(clean),
    style,
    model: getConfig().model,
    created: new Date().toISOString(),
    source: capped,
    words: countWords(capped),
    chunks: merged,
    meta: {
      source: failed === aiBatches.length ? "local" : "ai",
      batches: aiBatches.length,
      failedBatches: failed,
      tailChunks: 0,
      ms: Date.now() - started,
    },
  };

  cache[id] = script;
  saveMap(SCRIPTS_KEY, cache);
  return script;
}

export function listScripts() {
  const cache = loadMap(SCRIPTS_KEY);
  return Object.values(cache)
    .map((script) => ({
      id: script.id,
      title: script.title || "Untitled",
      style: script.style || "study",
      words: script.words || 0,
      chunks: (script.chunks || []).length,
      created: script.created || "",
      source: script.meta?.source || "ai",
    }))
    .sort((a, b) => String(b.created).localeCompare(String(a.created)))
    .slice(0, 30);
}

export function getScript(id) {
  return loadMap(SCRIPTS_KEY)[id] || null;
}

export async function edit(rawText) {
  const before = stripMarkup(rawText);
  if (!before) throw new Error("nothing to edit");
  const id = hashId(`edit|${CACHE_TAG}|${before}`);
  const cache = loadMap(EDITS_KEY);
  if (cache[id]) return { ...cache[id], cached: true };

  const skill = await fetchSkill("edit");
  const json = await postCompletion([
    { role: "system", content: skill },
    { role: "user", content: `TEXT TO EDIT:\n${before.slice(0, 30_000)}` },
  ], { maxTokens: 6000, temperature: 0 });

  const after = stripMarkup(String(json.text ?? ""));
  const beforeWords = countWords(before);
  const afterWords = countWords(after);
  if (!afterWords) throw new Error("editor returned empty text");
  if (afterWords < beforeWords * 0.6 || afterWords > beforeWords * 1.5) {
    throw new Error("editor changed the text too much — kept your original");
  }

  const result = {
    id, text: after, model: getConfig().model,
    created: new Date().toISOString(), beforeWords, afterWords,
  };
  cache[id] = result;
  saveMap(EDITS_KEY, cache);
  return result;
}

// ------------------------------------------------------------------- uploads

function fromBase64(data) {
  const binary = atob(String(data).replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function inflate(bytes, format = "deflate") {
  // PDF streams often carry padding after the zlib end marker.
  for (let cut = 0; cut < 24; cut += 1) {
    try {
      const view = bytes.subarray(0, bytes.length - cut);
      const stream = new Blob([view]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      if (!/trailing|unexpected end|invalid/i.test(String(error?.message || ""))) break;
    }
  }
  return bytes;
}

async function pdfText(bytes) {
  const latin = new TextDecoder("iso-8859-1").decode(bytes);
  const blocks = [];
  const streamRe = /stream\r?\n/g;
  let match;
  let streams = 0;

  while ((match = streamRe.exec(latin)) !== null && streams < 300) {
    const start = match.index + match[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) continue;
    const byteChunk = bytes.subarray(start, end);
    streams += 1;
    const inflated = await inflate(byteChunk, "deflate");
    const text = new TextDecoder("iso-8859-1").decode(inflated);
    const btRe = /\bBT\b[\s\S]*?\bET\b/g;
    let bt;
    while ((bt = btRe.exec(text)) !== null) {
      const stringRe = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]{4,}>/g;
      let token;
      const parts = [];
      while ((token = stringRe.exec(bt[0])) !== null) {
        let value = token[0];
        if (value[0] === "(") {
          value = value.slice(1, -1).replace(/\\([nrtbf()\\])/g, (_, char) => (
            { n: "\n", r: "\r", t: "\t", b: "", f: "" }[char] || char
          ));
        } else {
          const raw = new Uint8Array(
            value.slice(1, -1).replace(/\s/g, "").match(/.{2}/g)?.map((x) => parseInt(x, 16)) || [],
          );
          value = new TextDecoder("iso-8859-1").decode(raw);
        }
        if (value.includes("\u0000")) value = value.replace(/\u0000/g, "");
        if (/[A-Za-z0-9]/.test(value)) parts.push(value);
      }
      if (parts.length) blocks.push(parts.join(""));
    }
  }

  const useful = blocks.filter((line) => {
    if (line.length < 3) return false;
    const printable = [...line].filter((char) => char >= " " && char <= "~").length;
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    return printable / line.length > 0.9 && letters / line.length > 0.4;
  });
  const text = useful.join("\n").trim();
  return {
    text,
    method: "pdf-text",
    warning: /[A-Za-z]{3}/.test(text)
      ? ""
      : "No selectable text in this PDF — export a page as a photo and upload that instead.",
  };
}

async function docxText(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  for (let i = 0; i < bytes.length - 30; i += 1) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const method = view.getUint16(i + 8, true);
    const nameLength = view.getUint16(i + 26, true);
    const extraLength = view.getUint16(i + 28, true);
    const name = decoder.decode(bytes.slice(i + 30, i + 30 + nameLength));
    if (name !== "word/document.xml") continue;
    const start = i + 30 + nameLength + extraLength;
    const size = view.getUint32(i + 18, true);
    if (!size) break;
    const packed = bytes.subarray(start, start + size);
    const xmlBytes = await inflate(packed, method === 8 ? "deflate-raw" : "deflate");
    return new TextDecoder().decode(xmlBytes);
  }
  return "";
}

export async function upload(name, data) {
  const bytes = fromBase64(data);
  const ext = String(name).split(".").pop().toLowerCase();

  if (["txt", "md", "csv", "json", "log", "rtf"].includes(ext)) {
    return { text: new TextDecoder().decode(bytes).trim(), method: "text", warning: "" };
  }

  if (ext === "pdf") return pdfText(bytes);

  if (ext === "docx") {
    const xml = await docxText(bytes);
    const text = xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .trim();
    return { text, method: "docx", warning: text ? "" : "Could not read this docx." };
  }

  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(ext)) {
    const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", tif: "image/tiff", tiff: "image/tiff" }[ext] || `image/${ext}`;
    const json = await postCompletion([
      {
        role: "system",
        content: "You transcribe documents exactly. Never summarize, translate, correct meaning or add words. Preserve the original script and line order.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Write out every word visible in this photo, exactly as written. Keep line breaks and numbers. Write [unclear] for words you cannot read. Output plain text only." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${data}` } },
        ],
      },
    ], { maxTokens: 5000, temperature: 0, raw: true });
    const text = String(json || "").trim();
    return { text, method: "ai-vision", warning: text ? "" : "No words found in the photo." };
  }

  return { text: new TextDecoder().decode(bytes).trim(), method: "text", warning: "unknown file type" };
}
