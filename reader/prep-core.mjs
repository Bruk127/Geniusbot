// reader/prep-core.mjs
// The prep pipeline: text -> AI reading script -> JSON on disk.
// Used by server.mjs (HTTP) and prep.mjs (CLI, pre-prep before a study session).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { chunkText, countWords, stripMarkup } from "./chunk.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = resolve(ROOT, "scripts");
export const EDITS_DIR = resolve(ROOT, "edits");

const SKILL_PATH = resolve(ROOT, "skill", "reading-skill.md");
const EDIT_SKILL_PATH = resolve(ROOT, "skill", "editing-skill.md");

const MAX_AI_CHARS = 60_000;
const BATCH_CHARS = 1_300;
const MAX_BATCHES = 48;
const CONCURRENCY = 4;
const CALL_TIMEOUT_MS = 45_000;
const MIN_KEEP_RATIO = 0.65;
// Bump when the reading or editing skill changes so old scripts are not reused.
const CACHE_VERSION = 2;

// ---------------------------------------------------------------- credentials

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

/** Strip // and block comments without touching string contents. */
function stripJsonComments(source) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }

  return out.replace(/,\s*([}\]])/g, "$1");
}

/** Read the cent provider out of the opencode config so no key has to be pasted. */
function readOpencodeConfig() {
  const configDir = process.env.XDG_CONFIG_HOME
    ? resolve(process.env.XDG_CONFIG_HOME, "opencode")
    : resolve(homedir(), ".config", "opencode");

  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const path = resolve(configDir, name);
    if (!existsSync(path)) continue;
    try {
      const config = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
      const providers = config.provider || {};
      const key = Object.keys(providers).find((providerName) => /cent/i.test(providerName));
      if (!key) continue;
      const provider = providers[key] || {};
      const options = provider.options || {};
      const baseURL = options.baseURL || options.baseUrl;
      const apiKey = options.apiKey || options.api_key;
      if (!baseURL || !apiKey) continue;

      let model = "";
      if (typeof config.model === "string" && config.model.startsWith(`${key}/`)) {
        model = config.model.slice(key.length + 1);
      }
      if (!model && provider.models) model = Object.keys(provider.models)[0] || "";

      return { baseURL, apiKey, model, source: path };
    } catch (error) {
      console.warn(`[readslow] could not parse ${path}: ${error.message}`);
    }
  }
  return null;
}

const envFile = parseEnvFile(resolve(ROOT, ".env"));
const opencode = readOpencodeConfig();

export const AI = {
  baseURL: process.env.CENT_BASE_URL || envFile.CENT_BASE_URL || opencode?.baseURL || "https://api.cent-ai.dev/v1",
  apiKey: process.env.CENT_API_KEY || envFile.CENT_API_KEY || opencode?.apiKey || "",
  model: process.env.CENT_MODEL || envFile.CENT_MODEL || opencode?.model || "hy4-flash:free",
  source: process.env.CENT_API_KEY || envFile.CENT_API_KEY ? "env" : opencode?.source || "none",
};

let skillPrompt = "";
try {
  skillPrompt = readFileSync(SKILL_PATH, "utf8");
} catch {
  skillPrompt = 'Return JSON only: {"chunks":[{"text":"...","pauseMs":600,"emphasis":[]}]}';
}

let editSkillPrompt = "";
try {
  editSkillPrompt = readFileSync(EDIT_SKILL_PATH, "utf8");
} catch {
  editSkillPrompt = 'Return JSON only: {"text":"corrected text"}';
}

// ------------------------------------------------------------------- helpers

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function scriptId(text, style) {
  return createHash("sha1").update(`${CACHE_VERSION}\u0000${style}\u0000${text}`).digest("hex").slice(0, 16);
}

/** Correct a scanned/pasted page with the same model, then cache the result. */
export async function editText(rawText) {
  const before = stripMarkup(rawText);
  if (!before) throw Object.assign(new Error("nothing to edit"), { status: 400 });

  const id = createHash("sha1").update(`edit\u0000${CACHE_VERSION}\u0000${before}`).digest("hex").slice(0, 16);
  const editFile = resolve(EDITS_DIR, `${id}.json`);
  const wasCached = existsSync(editFile);

  if (!wasCached) {
    if (!AI.apiKey) throw new Error("no cent api key configured");

    const data = await postCompletion({
      model: AI.model,
      messages: [
        { role: "system", content: editSkillPrompt },
        { role: "user", content: `TEXT TO EDIT:\n${before.slice(0, 30_000)}` },
      ],
      temperature: 0,
      max_tokens: 6000,
      thinking: { type: "disabled" },
    });

    const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
    const json = parseJsonLoose(content);
    const after = stripMarkup(String(json.text ?? ""));

    const beforeWords = countWords(before);
    const afterWords = countWords(after);
    if (!afterWords) throw new Error("editor returned empty text");
    if (afterWords < beforeWords * 0.6 || afterWords > beforeWords * 1.5) {
      throw new Error("editor changed the text too much — kept your original");
    }

    mkdirSync(EDITS_DIR, { recursive: true });
    writeFileSync(editFile, JSON.stringify({
      id,
      text: after,
      model: AI.model,
      created: new Date().toISOString(),
      beforeWords,
      afterWords,
    }, null, 2));
  }

  const result = JSON.parse(readFileSync(editFile, "utf8"));
  return {
    text: result.text,
    beforeWords: result.beforeWords,
    afterWords: result.afterWords,
    model: result.model,
    cached: wasCached,
  };
}

export function scriptPath(id) {
  return resolve(SCRIPTS_DIR, `${id}.json`);
}

export function loadScript(id) {
  try {
    return JSON.parse(readFileSync(scriptPath(id), "utf8"));
  } catch {
    return null;
  }
}

export function saveScript(script) {
  mkdirSync(SCRIPTS_DIR, { recursive: true });
  writeFileSync(scriptPath(script.id), JSON.stringify(script, null, 2));
}

export function listScripts() {
  try {
    mkdirSync(SCRIPTS_DIR, { recursive: true });
    const files = readdirSync(SCRIPTS_DIR).filter((name) => name.endsWith(".json")).slice(0, 400);
    const scripts = [];
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(resolve(SCRIPTS_DIR, file), "utf8"));
        if (!data?.id || !Array.isArray(data.chunks)) continue;
        scripts.push({
          id: data.id,
          title: data.title || "Untitled",
          style: data.style || "study",
          words: data.words || 0,
          chunks: data.chunks.length,
          created: data.created || "",
          source: data.meta?.source || "ai",
        });
      } catch {
        /* a half-written or hand-edited file should not break the library */
      }
    }
    return scripts.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  } catch {
    return [];
  }
}

function parseJsonLoose(content) {
  let text = String(content ?? "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("model returned no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeEmphasis(rawList, text) {
  const words = text.split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ""));
  const out = [];

  for (const raw of rawList) {
    const target = String(raw).toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
    if (!target) continue;

    const exact = words.find((word) => word.toLowerCase() === target);
    if (exact) {
      out.push(exact);
      continue;
    }

    // The model sometimes glues a phrase together: "lightreactions".
    for (let i = 0; i < words.length; i += 1) {
      let acc = "";
      for (let j = i; j < words.length; j += 1) {
        acc += words[j].toLowerCase();
        if (acc === target) {
          out.push(words[i]);
          i = words.length;
          break;
        }
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
    const words = countWords(text);

    if (words > 14) {
      // Enforce the calm pacing even when the model overshoots.
      const pieces = chunkText(text, { maxWords: 12 }).chunks;
      pieces.forEach((piece, index) => {
        out.push({
          text: piece.text,
          pauseMs: index === pieces.length - 1 ? pauseMs : piece.pauseMs,
          emphasis: index === pieces.length - 1 ? emphasis : [],
          cue: index === 0 ? cue : "",
        });
      });
      continue;
    }

    out.push({ text, pauseMs, emphasis, cue });
  }

  return out;
}

/** Pack paragraphs into model-sized batches, keeping paragraph breaks intact. */
function makeBatches(text, limit) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const batches = [];
  let current = "";

  const flush = () => {
    if (current.trim()) batches.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    const pieces = paragraph.length <= limit
      ? [paragraph]
      : chunkText(paragraph).chunks.map((chunk) => chunk.text);

    if (!current) current = pieces[0];
    else if (current.length + pieces[0].length + 2 <= limit) current += `\n\n${pieces[0]}`;
    else {
      flush();
      current = pieces[0];
    }

    for (const piece of pieces.slice(1)) {
      if (current.length + piece.length + 1 <= limit) current += `\n${piece}`;
      else {
        flush();
        current = piece;
      }
    }
  }

  flush();
  return batches;
}

async function runPool(items, worker, limit) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

function guessTitle(text) {
  const first = stripMarkup(text).split(/\n{2,}/)[0] || "";
  const words = first.replace(/[^\p{L}\p{N}\s'-]/gu, "").trim().split(/\s+/).filter(Boolean);
  const title = words.slice(0, 7).join(" ");
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : "Untitled";
}

// ------------------------------------------------------------------ model call

async function postCompletion(body) {
  const response = await fetch(`${AI.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${AI.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw Object.assign(new Error(`provider ${response.status}: ${detail.slice(0, 160)}`), { status: response.status });
  }

  return response.json();
}

async function callModel(batch, style, wantTitle) {
  const messages = [
    { role: "system", content: skillPrompt },
    {
      role: "user",
      content: [
        `STYLE: ${style}`,
        wantTitle
          ? 'Give a short title (2-6 words) taken from the text. Set "title": null in every other batch.'
          : 'Set "title": null.',
        "TEXT:",
        batch,
      ].join("\n"),
    },
  ];

  const body = {
    model: AI.model,
    messages,
    temperature: 0.2,
    max_tokens: 2400,
    stream: false,
    // hy4 thinks itself into a token wall unless thinking is off. Off = ~4s per batch.
    thinking: { type: "disabled" },
  };

  let data;
  try {
    data = await postCompletion(body);
  } catch (error) {
    if (error.status !== 400) throw error;
    delete body.thinking; // provider without the flag
    data = await postCompletion(body);
  }

  const content = data?.choices?.[0]?.message?.content ?? "";
  if (!String(content).trim()) throw new Error("model returned empty content");
  return parseJsonLoose(content);
}

/** Vision transcription of a photo through the same cent provider. */
export async function readPhoto(buffer, mime = "image/png") {
  if (!AI.apiKey) throw new Error("no provider key");

  const url = `data:${mime};base64,${buffer.toString("base64")}`;
  const data = await postCompletion({
    model: AI.model,
    messages: [
      {
        role: "system",
        content: "You transcribe documents exactly. You never summarize, translate, correct spelling, or add words. You preserve the original script (English, Amharic, or anything else) and the original line order.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Write out every word visible in this photo, exactly as written. Keep line breaks and paragraph order. Keep maths, numbers and punctuation. If a word is too unclear to read, write [unclear] in its place. Output plain text only — no markdown, no commentary, no translation.",
          },
          { type: "image_url", image_url: { url } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 5000,
    thinking: { type: "disabled" },
  });

  const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
  if (!content) throw new Error("photo transcription came back empty");
  return content;
}

// ---------------------------------------------------------------------- prep

/**
 * Turn text into a stored reading script.
 * Returns the script JSON (cached when the same text + style was prepped before).
 */
export async function prepareText(rawText, options = {}) {
  const style = ["study", "exam", "story"].includes(options.style) ? options.style : "study";
  const clean = stripMarkup(rawText);
  if (!clean) throw Object.assign(new Error("nothing to read after cleanup"), { status: 400 });

  const capped = clean.slice(0, MAX_AI_CHARS);
  const id = scriptId(capped, style);

  if (!options.force) {
    const cached = loadScript(id);
    if (cached) return { ...cached, meta: { ...cached.meta, cached: true } };
  }

  if (!AI.apiKey) {
    const chunks = chunkText(capped).chunks;
    return {
      id,
      title: options.title || guessTitle(clean),
      style,
      model: "local",
      created: new Date().toISOString(),
      source: capped,
      words: countWords(capped),
      chunks,
      meta: { source: "local", reason: "no cent api key found", batches: 0, failedBatches: 0, tailChunks: 0, ms: 0, cached: false },
    };
  }

  const started = Date.now();
  const batches = makeBatches(capped, BATCH_CHARS);
  const aiBatches = batches.slice(0, MAX_BATCHES);
  const tailText = batches.slice(MAX_BATCHES).join("\n\n");

  const results = await runPool(aiBatches, async (batch, index) => {
    try {
      const json = await callModel(batch, style, index === 0);
      const chunks = sanitizeChunks(json);
      if (!chunks.length) throw new Error("model returned no phrases");

      const kept = chunks.reduce((sum, chunk) => sum + countWords(chunk.text), 0);
      if (kept < countWords(batch) * MIN_KEEP_RATIO) throw new Error("model dropped content");

      return {
        ok: true,
        chunks,
        title: typeof json.title === "string" ? json.title.trim().slice(0, 90) : null,
      };
    } catch (error) {
      return { ok: false, chunks: chunkText(batch).chunks, error: String(error.message || error) };
    }
  }, CONCURRENCY);

  const merged = [];
  let paraBase = 0;
  let failed = 0;
  let title = "";

  for (const result of results) {
    if (!result.ok) failed += 1;
    if (!title && result.title) title = result.title;

    let maxPara = 0;
    for (const chunk of result.chunks) {
      const para = Number.isFinite(chunk.para) ? chunk.para : 0;
      maxPara = Math.max(maxPara, para);
      merged.push({ ...chunk, para: para + paraBase });
    }
    paraBase += maxPara + 1;
  }

  let tailChunks = 0;
  if (tailText.trim()) {
    const tail = chunkText(tailText).chunks.map((chunk) => ({ ...chunk, para: chunk.para + paraBase }));
    tailChunks = tail.length;
    merged.push(...tail);
  }

  // The model's cue is authoritative for line starts; local fallbacks carry
  // their own para index. Fold both into one clean paragraph numbering.
  let paragraph = 0;
  const originalParas = merged.map((chunk) => chunk.para);
  merged.forEach((chunk, index) => {
    const prevPara = originalParas[index - 1];
    const explicitBreak = Number.isFinite(chunk.para) && Number.isFinite(prevPara)
      && chunk.para !== prevPara;
    if (index > 0 && (chunk.cue === "new line" || explicitBreak)) paragraph += 1;
    chunk.para = paragraph;
  });

  const script = {
    id,
    title: options.title || title || guessTitle(clean),
    style,
    model: AI.model,
    created: new Date().toISOString(),
    source: capped,
    words: countWords(capped),
    chunks: merged,
    meta: {
      source: failed === aiBatches.length ? "local" : "ai",
      batches: aiBatches.length,
      failedBatches: failed,
      tailChunks,
      ms: Date.now() - started,
      cached: false,
    },
  };

  if (failed < aiBatches.length) saveScript(script);
  return script;
}
