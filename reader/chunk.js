// reader/chunk.js
// Shared phrase chunker: raw text -> breath-sized phrases with pause hints.
// Imported by the browser (instant local prep) and the Node server (fallback + tail).

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "mx", "dr", "prof", "rev", "sr", "jr", "st", "mt", "vs", "etc",
  "eg", "ie", "fig", "figs", "no", "nos", "vol", "vols", "approx", "dept", "est",
  "inc", "ltd", "co", "corp", "ca", "cf", "al", "ed", "eds", "pp", "ch", "sec",
  "art", "para", "pl", "sing", "esp", "jan", "feb", "mar", "apr", "jun", "jul",
  "aug", "sep", "sept", "oct", "nov", "dec", "u.s", "u.k", "e.g", "i.e", "a.m", "p.m",
]);

const WORD_RE = /\S+/g;

const FURNITURE = [
  /^\s*\d{1,4}\s*$/,                                             // bare page number
  /^\s*page\s+\d+\s*$/i,
  /^\s*(?:the\s+)?(?:[A-Za-z]+\s+){0,4}(?:student|pupil)\s+textbook\s+grade\s*\d+\s*$/i,
  /^\s*(?:grade\s*\d+\s*)?[A-Za-z]+\s+(?:student\s+)?textbook\s*$/i,
  /^\s*copyright\s*.*$/i,
  /^\s*www\.\S+\s*$/i,
];

function isFurniture(line) {
  return FURNITURE.some((pattern) => pattern.test(line));
}

/**
 * Join wrapped lines, keep real block starts, and throw away page furniture
 * (page numbers, running heads, textbook footers).
 */
function normalizeLines(input) {
  const lines = String(input).split("\n");
  const out = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (isFurniture(line)) continue;

    const startsBlock = /^(?:\d{1,3}[.)]?\s+|\d{1,3}[.)]\s*$|[-*•]\s+|#{1,6}\s+|[A-Z][A-Za-z ]{0,30}:\s)/.test(line);
    const prev = out[out.length - 1];
    const prevEndsSentence = prev && /[.!?:;"”]$/.test(prev);

    if (!prev) out.push(line);
    else if (prev.endsWith("-") && /^[a-z]/.test(line)) out[out.length - 1] = `${prev}${line}`;
    else if (startsBlock || prevEndsSentence) out.push("", line);
    else out[out.length - 1] = `${prev} ${line}`;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function countWords(text) {
  const matches = String(text ?? "").trim().match(WORD_RE);
  return matches ? matches.length : 0;
}

/** Strip markdown noise that should never be spoken aloud. Keeps the words. */
export function stripMarkup(input) {
  let text = String(input ?? "").replace(/\r\n?/g, "\n");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)(?<!\s)\*(?=[\s).,;:!?]|$)/g, "$1$2");
  text = text.replace(/(^|[\s(])_(?!\s)([^_\n]+?)(?<!\s)_(?=[\s).,;:!?]|$)/g, "$1$2");
  text = text.replace(/~~(.*?)~~/g, "$1");
  text = text.replace(/<[^>]{1,80}>/g, " ");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/ *\n */g, "\n");
  return normalizeLines(text);
}

/** Sentence splitter that survives abbreviations, initials, decimals and URLs. */
function splitSentences(paragraph) {
  const out = [];
  let start = 0;

  for (let i = 0; i < paragraph.length; i += 1) {
    const ch = paragraph[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    let j = i + 1;
    while (j < paragraph.length && /["'”’)\]]/.test(paragraph[j])) j += 1;

    // "3.14", "example.com" — no whitespace after the dot, not a sentence end.
    if (j < paragraph.length && !/\s/.test(paragraph[j])) {
      i = j - 1;
      continue;
    }

    if (ch === ".") {
      const before = paragraph.slice(start, i);
      const match = before.match(/([A-Za-z][A-Za-z.]*)$/);
      const token = match ? match[1].toLowerCase() : "";
      if (ABBREVIATIONS.has(token) || /^[a-z]$/.test(token)) {
        i = j - 1;
        continue;
      }
      const rest = paragraph.slice(j).match(/\S/);
      if (rest && /[a-z]/.test(rest[0])) {
        i = j - 1;
        continue;
      }
    }

    out.push(paragraph.slice(start, j).trim());
    start = j;
    i = j - 1;
  }

  const tail = paragraph.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

const SPLIT_RE = /([;:]|—|–|,|\band\b|\bbut\b|\bso\b|\bbecause\b|\bwhich\b|\bthat\b|\bwhile\b|\bwhen\b|\bwhere\b|\balthough\b|\bthough\b|\bhowever\b|\bthen\b|\bor\b)/gi;

/** Break a sentence that is too long for one breath, at the most even seam. */
function splitLong(text, maxWords, minWords) {
  const t = text.trim();
  const total = countWords(t);
  if (total <= maxWords) return [t];

  const candidates = [];
  SPLIT_RE.lastIndex = 0;
  let match;
  while ((match = SPLIT_RE.exec(t)) !== null) {
    const leftWords = countWords(t.slice(0, match.index));
    const rightWords = total - leftWords - countWords(match[0]);
    if (leftWords < minWords || rightWords < minWords) continue;

    const isPunctuation = /^[;:,—–]$/.test(match[0]);
    // Punctuation stays with the left phrase. Conjunctions move to the right phrase.
    candidates.push({
      at: isPunctuation ? match.index + match[0].length : match.index,
      leftWords,
    });
  }

  if (candidates.length) {
    const target = total / 2;
    const best = candidates.reduce(
      (a, b) => (Math.abs(b.leftWords - target) < Math.abs(a.leftWords - target) ? b : a),
    );
    const left = t.slice(0, best.at).trim();
    const right = t.slice(best.at).trim();
    if (left && right && left !== t && right !== t) {
      return [...splitLong(left, maxWords, minWords), ...splitLong(right, maxWords, minWords)];
    }
  }

  // No usable seam: cut at the word boundary nearest the middle.
  const positions = [];
  const wordRe = /\S+/g;
  let wm;
  while ((wm = wordRe.exec(t)) !== null) positions.push(wm.index);
  const at = positions[Math.min(Math.ceil(total / 2), positions.length - 1)];
  if (!at) return [t];
  return [...splitLong(t.slice(0, at), maxWords, minWords), ...splitLong(t.slice(at), maxWords, minWords)];
}

export function pauseFor(text, isParagraphEnd = false) {
  const tail = String(text).trim().replace(/["'”’)\]]+$/, "").slice(-1);
  let ms = 200;
  if (/[.!?]/.test(tail)) ms = tail === "?" || tail === "!" ? 720 : 620;
  else if (tail === ":") ms = 520;
  else if (tail === ";") ms = 480;
  else if (/[,—–]/.test(tail)) ms = tail === "," ? 320 : 380;
  if (isParagraphEnd) ms = Math.max(ms, 950);
  return ms;
}

/**
 * Split text into phrases.
 * @returns {{chunks: Array<{text:string,pauseMs:number,emphasis:string[],para:number}>, words:number, chars:number}}
 */
export function chunkText(input, options = {}) {
  const maxWords = options.maxWords ?? 12;
  const minWords = options.minWords ?? 4;
  const text = stripMarkup(input);
  const chunks = [];

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  paragraphs.forEach((paragraph, paraIndex) => {
    const pieces = [];
    for (const sentence of splitSentences(paragraph)) {
      pieces.push(...splitLong(sentence, maxWords, minWords));
    }

    const merged = [];
    for (const piece of pieces) {
      const last = merged[merged.length - 1];
      if (last && countWords(last) < minWords && countWords(last) + countWords(piece) <= maxWords) {
        merged[merged.length - 1] = `${last} ${piece}`;
      } else {
        merged.push(piece);
      }
    }

    merged.forEach((piece, index) => {
      const isLast = index === merged.length - 1;
      let pauseMs = pauseFor(piece, isLast);
      // A short heading reads better with a beat after it.
      if (merged.length === 1 && countWords(piece) <= 8 && !/[.!?:;]$/.test(piece)) {
        pauseMs = 700;
      }
      chunks.push({ text: piece, pauseMs, emphasis: [], para: paraIndex });
    });
  });

  return {
    chunks,
    words: chunks.reduce((sum, c) => sum + countWords(c.text), 0),
    chars: text.length,
  };
}

/**
 * Re-cut phrases into tiny word groups for slow, deliberate reading.
 * Punctuation still gets its full pause; plain group ends get a short beat.
 */
export function microChunks(chunks, size = 4) {
  if (!size || size < 2) return chunks;

  const out = [];
  for (const chunk of chunks) {
    const words = String(chunk.text || "").trim().split(/\s+/).filter(Boolean);
    if (words.length <= size) {
      out.push(chunk);
      continue;
    }

    const emphasis = chunk.emphasis || [];
    for (let i = 0; i < words.length; i += size) {
      const group = words.slice(i, i + size).join(" ");
      const last = i + size >= words.length;
      const marked = /[.!?:;,—–]$/.test(group.replace(/["'”’)\]]+$/, ""));

      let pauseMs = 160;
      if (marked) pauseMs = pauseFor(group, false);
      if (last) pauseMs = Math.max(pauseMs, chunk.pauseMs || 0);

      out.push({
        text: group,
        pauseMs,
        emphasis: emphasis.filter((word) => group.toLowerCase().includes(String(word).toLowerCase())),
        cue: i === 0 ? (chunk.cue || "") : "",
        para: chunk.para,
      });
    }
  }
  return out;
}

export function estimateSeconds(chunks, rate = 0.85) {
  let words = 0;
  let pauses = 0;
  for (const chunk of chunks) {
    words += countWords(chunk.text);
    pauses += chunk.pauseMs || 0;
  }
  return Math.round(words / (3 * Math.max(rate, 0.3)) + pauses / 1000);
}
