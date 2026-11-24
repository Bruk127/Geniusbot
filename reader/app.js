// reader/app.js
// Browser side: phrase rendering, calm playback, repeat controls, voice commands, AI prep.

import { chunkText, countWords, estimateSeconds, microChunks } from "./chunk.js";

const $ = (selector, root = document) => root.querySelector(selector);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const el = {
  source: $("#source"),
  counts: $("#counts"),
  prepBtn: $("#prepBtn"),
  editBtn: $("#editBtn"),
  localBtn: $("#localBtn"),
  sampleBtn: $("#sampleBtn"),
  clearBtn: $("#clearBtn"),
  style: $("#style"),
  script: $("#script"),
  scroll: $("#scroll"),
  docTitle: $("#docTitle"),
  empty: $("#empty"),
  playBtn: $("#playBtn"),
  repeatBtn: $("#repeatBtn"),
  wordsBtn: $("#wordsBtn"),
  slowBtn: $("#slowBtn"),
  prevBtn: $("#prevBtn"),
  nextBtn: $("#nextBtn"),
  uploadBtn: $("#uploadBtn"),
  fileInput: $("#fileInput"),
  dropOverlay: $("#dropOverlay"),
  library: $("#library"),
  libraryList: $("#libraryList"),
  rate: $("#rate"),
  rateVal: $("#rateVal"),
  breath: $("#breath"),
  breathVal: $("#breathVal"),
  echo: $("#echo"),
  voice: $("#voice"),
  mic: $("#mic"),
  cues: $("#cues"),
  groupSize: $("#groupSize"),
  focus: $("#focus"),
  dimBtn: $("#dimBtn"),
  aiStatus: $("#aiStatus"),
  status: $("#status"),
  meta: $("#meta"),
  progressFill: $("#progressFill"),
  toast: $("#toast"),
};

const SETTINGS_KEY = "readslow.settings.v1";
const TEXT_KEY = "readslow.text.v1";
const POS_KEY = "readslow.pos.v1";
const DEFAULTS = { rate: 0.85, breath: 1, echo: 0, voiceURI: "", focus: true, dim: false, style: "study", cues: true, groupSize: 4 };

const SAMPLE = `Photosynthesis is the process by which plants turn light energy into chemical energy. It happens in two stages: the light reactions, which need sunlight and water, and the Calvin cycle, which fixes carbon dioxide into sugar. Chlorophyll absorbs mostly red and blue light, which is why leaves look green. The rate of photosynthesis rises with light intensity up to a saturation point, then levels off. Temperature matters too — enzymes lose shape above about forty degrees Celsius, and the whole process stalls.`;

const synth = window.speechSynthesis;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const supported = Boolean(synth && window.SpeechSynthesisUtterance);

const state = {
  chunks: [],
  baseChunks: [],
  idx: 0,
  playing: false,
  title: "",
  source: "local",
  voices: [],
  model: "",
  finished: false,
  scriptId: "",
  scriptKey: "",
  resumeNote: "",
};

let settings = { ...DEFAULTS, ...readStore(SETTINGS_KEY, {}) };

let runId = 0;
let pendingTimer = null;
let wordTimers = [];
let speaking = false;
let echoLeft = 0;
let lastSpoken = { chunk: 0, word: 0 };
let toastTimer = null;
let buildTimer = null;
let rateTimer = null;
let recognition = null;
let micWanted = false;
let currentScriptId = "";

// ------------------------------------------------------------------ storage

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — session still works */
  }
}

function saveSettings() {
  writeStore(SETTINGS_KEY, settings);
}

// -------------------------------------------------------------------- utils

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2200);
}

function setStatus(message) {
  el.status.textContent = message;
}

function fmtTime(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
}

function stripPunct(word) {
  return String(word).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
}

function wordIndexAt(text, charIndex) {
  const re = /\S+/g;
  let index = 0;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index <= charIndex) last = index;
    else break;
    index += 1;
  }
  return last;
}

function guessTitle(text) {
  const first = text.split(/\n{2,}/)[0] || "";
  const words = first.replace(/[^\p{L}\p{N}\s'-]/gu, "").trim().split(/\s+/).filter(Boolean);
  const title = words.slice(0, 7).join(" ");
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : "Untitled";
}

function voiceObject() {
  if (!settings.voiceURI) return null;
  return state.voices.find((voice) => voice.voiceURI === settings.voiceURI) || null;
}

function hashString(text) {
  let hash = 5381;
  const value = String(text || "");
  for (let i = 0; i < value.length; i += 1) hash = ((hash * 33) ^ value.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16);
}

function savePosition(index) {
  if (!state.scriptKey) return;
  const positions = readStore(POS_KEY, {});
  positions[state.scriptKey] = index;
  const keys = Object.keys(positions);
  if (keys.length > 40) delete positions[keys[0]];
  writeStore(POS_KEY, positions);
}

function clearPosition() {
  if (!state.scriptKey) return;
  const positions = readStore(POS_KEY, {});
  delete positions[state.scriptKey];
  writeStore(POS_KEY, positions);
}

// ---------------------------------------------------------------- rendering

function withParagraphs(chunks) {
  let para = 0;
  return chunks.map((chunk, index) => {
    let cue = chunk.cue || "";
    if (index > 0) {
      const prev = chunks[index - 1];
      const explicit = Number.isFinite(chunk.para) && Number.isFinite(prev.para);
      const breakHere = explicit ? chunk.para !== prev.para : (prev.pauseMs || 0) >= 950;
      if (breakHere) {
        para += 1;
        if (!cue) cue = "new line";
      }
    }
    return { ...chunk, para, cue: index === 0 ? "" : cue };
  });
}

function renderScript() {
  const frag = document.createDocumentFragment();
  let paragraph = null;
  let currentPara = -1;

  state.chunks.forEach((chunk, index) => {
    if (chunk.para !== currentPara) {
      paragraph = document.createElement("p");
      paragraph.className = `para${index > 0 && chunk.cue ? " cued" : ""}`;
      frag.appendChild(paragraph);
      currentPara = chunk.para;
    }

    const node = document.createElement("span");
    node.className = "chunk";
    node.dataset.i = String(index);
    node.title = `${chunk.pauseMs || 0} ms pause`;

    // The model may return a multi-word emphasis ("light reactions") or a glued
    // one ("lightreactions"); mark every word that participates in it.
    const emphasis = (chunk.emphasis || []).map((entry) => String(entry).toLowerCase());
    const words = chunk.text.split(/\s+/).filter(Boolean);

    words.forEach((word, wordIndex) => {
      const span = document.createElement("span");
      const clean = stripPunct(word);
      let isEmphasis = emphasis.includes(clean);
      if (!isEmphasis) {
        for (let size = 2; size <= 3 && !isEmphasis; size += 1) {
          if (wordIndex + size > words.length) break;
          const joined = words.slice(wordIndex, wordIndex + size)
            .map((w) => stripPunct(w)).join("");
          if (emphasis.includes(joined)) {
            isEmphasis = true;
            break;
          }
        }
      }
      span.className = `w${isEmphasis ? " em" : ""}`;
      span.dataset.w = String(wordIndex);
      span.textContent = word;
      node.appendChild(span);
      if (wordIndex < words.length - 1) node.appendChild(document.createTextNode(" "));
    });

    paragraph.appendChild(node);
    paragraph.appendChild(document.createTextNode(" "));
  });

  el.script.replaceChildren(frag);
  el.empty.hidden = state.chunks.length > 0;
  el.docTitle.hidden = !state.title || state.chunks.length === 0;
}

function applyChunks(chunks, title, source) {
  stopAll();
  state.playing = false;
  state.finished = false;
  state.baseChunks = chunks;
  const shaped = microChunks(chunks, settings.groupSize);
  state.chunks = withParagraphs(shaped).filter((chunk) => chunk && String(chunk.text || "").trim());
  state.idx = 0;
  state.title = title || guessTitle(el.source.value || "");
  state.source = source;
  state.raw = el.source.value;
  state.scriptId = source === "ai" ? currentScriptId : "";
  state.scriptKey = state.scriptId || `text:${hashString(state.raw)}`;
  el.library.hidden = !state.scriptId;

  state.resumeNote = "";
  const positions = readStore(POS_KEY, {});
  const saved = Number(positions[state.scriptKey]);
  if (Number.isFinite(saved) && saved > 0 && saved < state.chunks.length) {
    state.idx = saved;
    state.resumeNote = `resumed at phrase ${saved + 1}`;
  }

  el.docTitle.textContent = state.title;
  renderScript();
  document.body.classList.remove("has-active");
  if (state.resumeNote) setActiveChunk(state.idx);
  updateUI();
  updateProgress();
}

function buildLocal(text) {
  const result = chunkText(text);
  applyChunks(result.chunks, guessTitle(text), "local");
  return result;
}

// ------------------------------------------------------------------ progress

function updateProgress() {
  const total = state.chunks.length;
  if (!total) {
    el.progressFill.style.width = "0%";
    el.meta.textContent = "";
    return;
  }

  const position = state.playing ? state.idx + 0.5 : state.idx;
  el.progressFill.style.width = `${clamp((position / total) * 100, 0, 100)}%`;

  const rest = state.chunks.slice(state.idx);
  const words = rest.reduce((sum, chunk) => sum + countWords(chunk.text), 0);
  const seconds = estimateSeconds(rest, settings.rate);
  el.meta.textContent = `phrase ${state.idx + 1}/${total} · ${words} words · ~${fmtTime(seconds)} left`;
}

function updateUI() {
  el.playBtn.textContent = state.playing ? "Pause" : "Play";
  el.playBtn.setAttribute("aria-pressed", state.playing ? "true" : "false");
  document.body.classList.toggle("playing", state.playing);
  updateProgress();
}

function setActiveChunk(index) {
  el.script.querySelectorAll(".chunk.active").forEach((node) => node.classList.remove("active", "speaking"));
  el.script.querySelectorAll(".w.active").forEach((node) => node.classList.remove("active"));

  const node = el.script.querySelector(`.chunk[data-i="${index}"]`);
  document.body.classList.toggle("has-active", Boolean(node));
  if (!node) return;
  node.classList.add("active");
  savePosition(index);
  node.scrollIntoView({ block: "center", behavior: "smooth" });
}

function highlightWord(chunkIndex, wordIndex) {
  const node = el.script.querySelector(`.chunk[data-i="${chunkIndex}"]`);
  if (!node) return;

  const previous = node.querySelector(".w.active");
  if (previous) previous.classList.remove("active");

  const next = node.querySelector(`.w[data-w="${wordIndex}"]`);
  if (next) next.classList.add("active");

  lastSpoken = { chunk: chunkIndex, word: wordIndex };
}

function setSpeaking(on) {
  const active = el.script.querySelector(".chunk.active");
  if (active) active.classList.toggle("speaking", on);
}

// ------------------------------------------------------------------- speech

function clearWordTimers() {
  wordTimers.forEach((timer) => clearTimeout(timer));
  wordTimers = [];
}

function stopAll() {
  runId += 1;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  clearWordTimers();
  if (supported) {
    try { synth.cancel(); } catch { /* noop */ }
  }
  speaking = false;
  setSpeaking(false);
}

function startWordTimers(chunkIndex, fromWord, totalWords, rate, myRun) {
  clearWordTimers();
  const msPerWord = 60000 / (180 * Math.max(rate, 0.3));
  for (let word = fromWord + 1; word < totalWords; word += 1) {
    const timer = setTimeout(() => {
      if (myRun !== runId) return;
      highlightWord(chunkIndex, word);
    }, (word - fromWord) * msPerWord);
    wordTimers.push(timer);
  }
}

function speakAdhoc(text, onDone) {
  stopAll();
  if (!supported) return onDone();

  const myRun = runId;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = voiceObject();
  utterance.rate = settings.rate * 1.12;
  utterance.pitch = 0.9;
  utterance.volume = 0.9;
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-US";
  }

  utterance.onend = () => {
    if (myRun !== runId) return;
    speaking = false;
    setSpeaking(false);
    onDone();
  };
  utterance.onerror = () => {
    if (myRun !== runId) return;
    speaking = false;
    setSpeaking(false);
    onDone();
  };

  setTimeout(() => {
    if (myRun !== runId) return;
    try { synth.speak(utterance); } catch { onDone(); }
  }, 20);
}

function speakChunk(index, options = {}) {
  const chunk = state.chunks[index];
  if (!chunk) return;

  if (settings.cues && chunk.cue && !options.skipCue) {
    setStatus(chunk.cue === "new paragraph" ? "new paragraph" : "new line");
    return speakAdhoc(chunk.cue === "new paragraph" ? "New paragraph." : "New line.", () => (
      speakChunk(index, { ...options, skipCue: true })
    ));
  }

  stopAll();

  const words = chunk.text.split(/\s+/).filter(Boolean);
  const from = clamp(options.startWord ?? 0, 0, words.length - 1);
  const text = words.slice(from).join(" ");
  const rate = options.rateOverride ?? settings.rate;
  const myRun = runId;

  setActiveChunk(index);
  highlightWord(index, from);

  if (!supported) {
    setStatus("this browser has no speech engine — try Chrome or Edge");
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = voiceObject();
  utterance.rate = rate;
  utterance.pitch = 1;
  utterance.volume = 1;
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-US";
  }

  utterance.onstart = () => {
    if (myRun !== runId) return;
    speaking = true;
    setSpeaking(true);
    startWordTimers(index, from, words.length, rate, myRun);
  };

  utterance.onboundary = (event) => {
    if (myRun !== runId) return;
    if (event.name && event.name !== "word") return;
    const word = from + wordIndexAt(text, event.charIndex || 0);
    highlightWord(index, clamp(word, 0, words.length - 1));
  };

  utterance.onend = () => {
    if (myRun !== runId) return;
    speaking = false;
    setSpeaking(false);
    clearWordTimers();
    if (typeof options.onDone === "function") return options.onDone();
    scheduleNext(index, chunk, rate);
  };

  utterance.onerror = (event) => {
    if (myRun !== runId) return;
    speaking = false;
    setSpeaking(false);
    clearWordTimers();
    const reason = event?.error || "";
    if (reason === "canceled" || reason === "interrupted") return;
    if (typeof options.onDone === "function") return options.onDone();
    scheduleNext(index, chunk, rate);
  };

  // Chrome needs a breath between cancel() and speak(), or the utterance is dropped.
  setTimeout(() => {
    if (myRun !== runId) return;
    try { synth.speak(utterance); } catch { /* noop */ }
  }, 30);
}

function scheduleNext(index, chunk, rate) {
  if (!state.playing) return;

  if (echoLeft > 0) {
    echoLeft -= 1;
    pendingTimer = setTimeout(() => {
      if (!state.playing) return;
      speakChunk(index, { rateOverride: rate });
    }, 380);
    return;
  }

  const pause = Math.round((chunk.pauseMs ?? 250) * settings.breath);
  pendingTimer = setTimeout(() => {
    if (!state.playing) return;
    if (index + 1 >= state.chunks.length) {
      finish();
      return;
    }
    state.idx = index + 1;
    echoLeft = settings.echo;
    speakChunk(state.idx);
    updateUI();
  }, pause);
}

function playIndex(index) {
  if (!state.chunks.length) {
    toast("paste some text first");
    return;
  }
  state.idx = clamp(index, 0, state.chunks.length - 1);
  state.playing = true;
  state.finished = false;
  echoLeft = settings.echo;
  speakChunk(state.idx);
  updateUI();
}

function play() {
  if (!state.chunks.length) {
    toast("paste some text first");
    return;
  }
  if (state.finished) {
    state.idx = 0;
    state.finished = false;
  }
  state.playing = true;
  echoLeft = settings.echo;
  speakChunk(state.idx);
  updateUI();
}

function pause() {
  state.playing = false;
  stopAll();
  updateUI();
  setStatus("paused");
}

function togglePlay() {
  if (state.playing) pause();
  else play();
}

function finish() {
  state.playing = false;
  state.finished = true;
  clearPosition();
  stopAll();
  updateUI();
  el.progressFill.style.width = "100%";
  setStatus("finished — R repeats the last phrase");
}

function repeatChunk({ slow = false } = {}) {
  if (!state.chunks.length) return;
  state.playing = true;
  echoLeft = 0;
  const rate = slow ? Math.max(0.5, Math.round(settings.rate * 0.7 * 100) / 100) : undefined;
  speakChunk(state.idx, { skipCue: true, ...(rate ? { rateOverride: rate } : {}) });
  updateUI();
  setStatus(slow ? "repeating slowly" : "repeating phrase");
}

function repeatWords(count = 3) {
  const index = state.idx;
  const chunk = state.chunks[index];
  if (!chunk) return;

  const words = chunk.text.split(/\s+/).filter(Boolean);
  const spokenHere = lastSpoken.chunk === index;
  const endWord = spokenHere ? lastSpoken.word + 1 : Math.min(count, words.length);
  const startWord = Math.max(0, endWord - count);
  const snippet = words.slice(startWord, endWord).join(" ");
  if (!snippet) return;

  state.playing = true;
  echoLeft = 0;

  speakChunk(index, {
    startWord,
    skipCue: true,
    rateOverride: Math.max(0.55, settings.rate * 0.85),
    onDone: () => {
      if (!state.playing) return;
      if (endWord >= words.length) {
        if (index + 1 >= state.chunks.length) finish();
        else playIndex(index + 1);
      } else {
        speakChunk(index, { startWord: endWord, skipCue: true });
      }
    },
  });

  updateUI();
  setStatus(`repeating "${snippet}"`);
}

// ------------------------------------------------------------------ AI prep

async function checkHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const data = await response.json();
    state.model = data.model || "";
    if (data.ai) {
      el.aiStatus.textContent = `ai · ${data.model}`;
      el.aiStatus.dataset.state = "ok";
    } else {
      el.aiStatus.textContent = "local only · no key";
      el.aiStatus.dataset.state = "warn";
    }
  } catch {
    el.aiStatus.textContent = "local only · server offline";
    el.aiStatus.dataset.state = "warn";
  }
}

async function aiPrep() {
  const text = el.source.value.trim();
  if (!text) {
    toast("paste some text first");
    return;
  }

  if (state.playing) pause();

  el.prepBtn.disabled = true;
  el.prepBtn.textContent = "Prepping…";
  const started = Date.now();
  const label = state.model || "hy4";
  setStatus(`prepping with ${label}… 0s`);

  const ticker = setInterval(() => {
    setStatus(`prepping with ${label}… ${Math.round((Date.now() - started) / 1000)}s`);
  }, 500);

  try {
    const response = await fetch("/api/prep", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, style: settings.style }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `prep failed (${response.status})`);
    if (!Array.isArray(data.chunks) || !data.chunks.length) throw new Error("no phrases returned");

    currentScriptId = data.id || "";
    applyChunks(data.chunks, data.title, data.meta?.source || "ai");

    const meta = data.meta || {};
    const used = meta.source === "ai" ? data.model || label : "local chunking";
    const bits = [`${data.chunks.length} phrases`, used];
    if (meta.cached) bits.push("instant — pre-prepped");
    if (meta.failedBatches) bits.push(`${meta.failedBatches} batch fallback`);
    if (meta.tailChunks) bits.push(`${meta.tailChunks} tail phrases local`);
    setStatus(bits.join(" · "));
    if (data.id) toast(meta.cached ? "loaded from saved prep" : "saved to library");
  } catch (error) {
    currentScriptId = "";
    buildLocal(text);
    setStatus(`AI prep failed — local chunking kept (${error.message})`);
    toast("AI prep failed — local chunking");
  } finally {
    clearInterval(ticker);
    el.prepBtn.disabled = false;
    el.prepBtn.textContent = "Prep with AI";
  }
}

async function aiEdit() {
  const text = el.source.value.trim();
  if (!text) {
    toast("paste some text first");
    return;
  }

  if (state.playing) pause();

  el.editBtn.disabled = true;
  el.editBtn.textContent = "Editing…";
  const started = Date.now();
  const label = state.model || "hy4";
  setStatus(`editing with ${label}… 0s`);

  const ticker = setInterval(() => {
    setStatus(`editing with ${label}… ${Math.round((Date.now() - started) / 1000)}s`);
  }, 500);

  try {
    const response = await fetch("/api/edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `edit failed (${response.status})`);
    if (!String(data.text || "").trim()) throw new Error("editor returned no text");

    el.source.value = data.text;
    writeStore(TEXT_KEY, data.text);
    el.counts.textContent = `${countWords(data.text)} words · ${data.text.length} chars`;
    buildLocal(data.text);

    setStatus(`edited ${data.beforeWords} → ${data.afterWords} words · ${data.cached ? "instant" : "ai"} · prepping next`);
    await aiPrep();
  } catch (error) {
    setStatus(`AI edit failed — original kept (${error.message})`);
    toast("AI edit failed — original kept");
  } finally {
    clearInterval(ticker);
    el.editBtn.disabled = false;
    el.editBtn.textContent = "AI Edit";
  }
}

async function loadScript(id) {
  try {
    const response = await fetch(`/api/scripts/${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.chunks) || !data.chunks.length) {
      throw new Error(data.error || "script not found");
    }
    el.source.value = data.source || "";
    writeStore(TEXT_KEY, el.source.value);
    el.counts.textContent = `${countWords(el.source.value)} words · ${el.source.value.length} chars`;
    currentScriptId = data.id;
    applyChunks(data.chunks, data.title, data.meta?.source || "ai");
    if (data.style && ["study", "exam", "story"].includes(data.style)) {
      settings.style = data.style;
      el.style.value = data.style;
      saveSettings();
    }
    setStatus(state.resumeNote
      ? `loaded "${data.title}" — ${state.resumeNote}`
      : `loaded "${data.title}" — ${data.chunks.length} phrases · ${data.words || countWords(data.source || "")} words`);
  } catch (error) {
    toast(error.message || "could not load script");
  }
}

async function loadLibrary() {
  try {
    const response = await fetch("/api/scripts", { cache: "no-store" });
    const data = await response.json();
    const scripts = Array.isArray(data.scripts) ? data.scripts : [];
    el.library.hidden = scripts.length === 0;
    el.libraryList.innerHTML = scripts.slice(0, 12).map((script) => `
      <button type="button" class="lib-item" data-id="${esc(script.id)}" title="${esc(script.title)}">
        <span class="lib-title">${esc(script.title)}</span>
        <span class="lib-meta">${script.words}w · ${script.style}${script.source === "local" ? " · local" : ""}</span>
      </button>`).join("");
  } catch {
    el.library.hidden = true;
  }
}

// -------------------------------------------------------------------- voices

function loadVoices() {
  if (!supported) {
    el.voice.disabled = true;
    el.mic.disabled = true;
    setStatus("no speech engine in this browser");
    return;
  }

  const all = synth.getVoices() || [];
  if (!all.length) return;

  const score = (voice) => {
    let value = 0;
    if (/^en[-_]/i.test(voice.lang)) value += 5;
    if (/natural|neural|premium|enhanced/i.test(voice.name)) value += 3;
    if (/google|microsoft|samantha|aria|jenny|libby|sonia/i.test(voice.name)) value += 2;
    if (voice.localService) value += 1;
    return value;
  };

  state.voices = all.slice().sort((a, b) => score(b) - score(a));

  el.voice.innerHTML = `<option value="">default</option>${state.voices
    .map((voice) => `<option value="${esc(voice.voiceURI)}">${esc(voice.name)} — ${esc(voice.lang)}</option>`)
    .join("")}`;

  if (settings.voiceURI && !state.voices.some((voice) => voice.voiceURI === settings.voiceURI)) {
    settings.voiceURI = "";
    saveSettings();
  }
  el.voice.value = settings.voiceURI;
}

// ------------------------------------------------------------ voice commands

function setupRecognition() {
  if (!SpeechRecognition) {
    el.mic.disabled = true;
    el.mic.parentElement.title = "voice commands need Chrome or Edge";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.lang = voiceObject()?.lang || "en-US";

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (!event.results[i].isFinal) continue;
      handleCommand(event.results[i][0].transcript);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      micWanted = false;
      el.mic.checked = false;
      toast("mic blocked by the browser");
    }
  };

  recognition.onend = () => {
    if (micWanted) {
      try { recognition.start(); } catch { /* already running */ }
    }
  };
}

function setMic(on) {
  micWanted = on;
  if (!SpeechRecognition) {
    toast("voice commands need Chrome or Edge");
    return;
  }
  if (!recognition) setupRecognition();
  if (!recognition) return;

  recognition.lang = voiceObject()?.lang || "en-US";
  if (on) {
    try { recognition.start(); } catch { /* already running */ }
    toast("voice on — say repeat, slower, pause, next");
  } else {
    try { recognition.stop(); } catch { /* noop */ }
  }
}

function handleCommand(transcript) {
  const text = String(transcript || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text.split(" ").length > 5) return;

  if (/\b(slow|slower|slowly)\b/.test(text)) return repeatChunk({ slow: true });
  if (/\b(three words|last words|last three|three)\b/.test(text)) return repeatWords(3);
  if (/\b(repeat|again|once more|say that again)\b/.test(text)) return repeatChunk();
  if (/\b(pause|stop|hold on|wait)\b/.test(text)) return pause();
  if (/\b(next|forward)\b/.test(text)) return playIndex(state.idx + 1);
  if (/\b(back|previous|before)\b/.test(text)) return playIndex(state.idx - 1);
  if (/\b(play|resume|continue|go on)\b/.test(text)) return play();
}

// -------------------------------------------------------------------- upload

function fileToBase64(file) {
  return new Promise((resolvePromise, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolvePromise(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function handleFiles(files) {
  const list = [...files].filter(Boolean);
  if (!list.length) return;

  const pieces = [];
  let needsPrep = false;

  for (const file of list) {
    const ext = String(file.name).split(".").pop().toLowerCase();
    const plainText = ["txt", "md", "csv", "json", "log", "rtf"].includes(ext) || file.type.startsWith("text/");

    try {
      if (plainText) {
        pieces.push(await file.text());
        continue;
      }

      setStatus(`reading ${file.name}…`);
      const data = await fileToBase64(file);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, data }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `upload failed (${response.status})`);
      if (result.warning) toast(result.warning);
      pieces.push(result.text || "");
      needsPrep = true;
    } catch (error) {
      toast(`${file.name}: ${error.message}`);
    }
  }

  const text = pieces.filter(Boolean).join("\n\n").trim();
  if (!text) {
    toast("no readable text found");
    return;
  }

  el.source.value = text;
  writeStore(TEXT_KEY, text);
  el.counts.textContent = `${countWords(text)} words · ${text.length} chars`;
  buildLocal(text);
  setStatus(`loaded ${list.length} file${list.length > 1 ? "s" : ""} · ${countWords(text)} words`);

  if (needsPrep) aiPrep();
}

// -------------------------------------------------------------------- wiring

el.source.addEventListener("input", () => {
  const text = el.source.value;
  state.raw = text;
  writeStore(TEXT_KEY, text);
  el.counts.textContent = `${countWords(text)} words · ${text.length} chars`;

  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => {
    if (state.playing) return;
    buildLocal(text);
  }, 450);
});

el.playBtn.addEventListener("click", togglePlay);
el.editBtn.addEventListener("click", aiEdit);
el.uploadBtn.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("change", () => {
  handleFiles(el.fileInput.files);
  el.fileInput.value = "";
});

let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  event.preventDefault();
  dragDepth += 1;
  el.dropOverlay.hidden = false;
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
});
document.addEventListener("dragleave", (event) => {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.dropOverlay.hidden = true;
});
document.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  dragDepth = 0;
  el.dropOverlay.hidden = true;
  handleFiles(event.dataTransfer.files);
});
document.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])];
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (!images.length) return;
  event.preventDefault();
  handleFiles(images);
});
el.repeatBtn.addEventListener("click", () => repeatChunk());
el.wordsBtn.addEventListener("click", () => repeatWords(3));
el.slowBtn.addEventListener("click", () => repeatChunk({ slow: true }));
el.prevBtn.addEventListener("click", () => playIndex(state.idx - 1));
el.nextBtn.addEventListener("click", () => playIndex(state.idx + 1));
el.prepBtn.addEventListener("click", aiPrep);
el.localBtn.addEventListener("click", () => {
  buildLocal(el.source.value);
  setStatus("re-chunked locally");
});
el.libraryList.addEventListener("click", (event) => {
  const item = event.target.closest(".lib-item");
  if (!item) return;
  loadScript(item.dataset.id);
});
el.sampleBtn.addEventListener("click", () => {
  el.source.value = SAMPLE;
  el.source.dispatchEvent(new Event("input"));
  buildLocal(SAMPLE);
});
el.clearBtn.addEventListener("click", () => {
  el.source.value = "";
  writeStore(TEXT_KEY, "");
  state.chunks = [];
  state.title = "";
  state.idx = 0;
  state.finished = false;
  currentScriptId = "";
  clearPosition();
  el.library.hidden = true;
  stopAll();
  state.playing = false;
  document.body.classList.remove("has-active");
  el.script.replaceChildren();
  el.docTitle.hidden = true;
  el.empty.hidden = false;
  el.counts.textContent = "0 words";
  updateUI();
  setStatus("cleared");
});

el.script.addEventListener("click", (event) => {
  const chunkNode = event.target.closest(".chunk");
  if (!chunkNode) return;
  const index = Number(chunkNode.dataset.i);
  const wordNode = event.target.closest(".w");
  const wordIndex = wordNode ? Number(wordNode.dataset.w) : 0;

  state.idx = clamp(index, 0, state.chunks.length - 1);
  state.playing = true;
  echoLeft = settings.echo;
  speakChunk(state.idx, { startWord: wordIndex, skipCue: true });
  updateUI();
  setStatus("reading from here");
});

el.rate.addEventListener("input", () => {
  settings.rate = Number(el.rate.value);
  el.rateVal.textContent = `${settings.rate.toFixed(2)}×`;
  saveSettings();
  updateProgress();

  clearTimeout(rateTimer);
  rateTimer = setTimeout(() => {
    if (state.playing) speakChunk(state.idx);
  }, 160);
});

el.breath.addEventListener("input", () => {
  settings.breath = Number(el.breath.value);
  el.breathVal.textContent = `${settings.breath.toFixed(1)}×`;
  saveSettings();
});

el.echo.addEventListener("change", () => {
  settings.echo = Number(el.echo.value);
  saveSettings();
});

el.voice.addEventListener("change", () => {
  settings.voiceURI = el.voice.value;
  saveSettings();
  if (state.playing) speakChunk(state.idx);
  if (recognition && micWanted) recognition.lang = voiceObject()?.lang || "en-US";
});

el.mic.addEventListener("change", () => setMic(el.mic.checked));

el.focus.addEventListener("change", () => {
  settings.focus = el.focus.checked;
  document.body.classList.toggle("focus", settings.focus);
  saveSettings();
});

el.cues.addEventListener("change", () => {
  settings.cues = el.cues.checked;
  saveSettings();
  if (settings.cues) toast("line cues on — each new paragraph is announced");
});

el.groupSize.addEventListener("change", () => {
  settings.groupSize = Number(el.groupSize.value);
  saveSettings();
  if (state.baseChunks.length) {
    const title = state.title;
    const source = state.source;
    applyChunks(state.baseChunks, title, source);
    setStatus(`reading ${settings.groupSize ? `${settings.groupSize} words at a time` : "whole phrases"}`);
  }
});

el.dimBtn.addEventListener("click", () => {
  settings.dim = !settings.dim;
  document.body.classList.toggle("dim", settings.dim);
  el.dimBtn.textContent = settings.dim ? "light" : "dim";
  saveSettings();
});

el.style.addEventListener("change", () => {
  settings.style = el.style.value;
  saveSettings();
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || event.target.isContentEditable) return;

  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  } else if (event.key === "r" || event.key === "R") {
    event.preventDefault();
    repeatChunk();
  } else if (event.key === "w" || event.key === "W") {
    event.preventDefault();
    repeatWords(3);
  } else if (event.key === "s" || event.key === "S") {
    event.preventDefault();
    repeatChunk({ slow: true });
  } else if (event.key === "e" || event.key === "E") {
    event.preventDefault();
    aiEdit();
  } else if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    el.cues.checked = !el.cues.checked;
    el.cues.dispatchEvent(new Event("change"));
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    playIndex(state.idx + 1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    playIndex(state.idx - 1);
  } else if (event.key === "Escape") {
    pause();
  } else if (event.key === "+" || event.key === "=") {
    el.rate.value = String(clamp(settings.rate + 0.05, 0.5, 1.2));
    el.rate.dispatchEvent(new Event("input"));
  } else if (event.key === "-") {
    el.rate.value = String(clamp(settings.rate - 0.05, 0.5, 1.2));
    el.rate.dispatchEvent(new Event("input"));
  }
});

window.addEventListener("beforeunload", () => {
  if (supported) synth.cancel();
});

if (supported) {
  synth.addEventListener?.("voiceschanged", loadVoices);
  synth.onvoiceschanged = loadVoices;
  loadVoices();
  setTimeout(loadVoices, 600);
}

// -------------------------------------------------------------------- boot

function boot() {
  el.rate.value = String(settings.rate);
  el.rateVal.textContent = `${settings.rate.toFixed(2)}×`;
  el.breath.value = String(settings.breath);
  el.breathVal.textContent = `${settings.breath.toFixed(1)}×`;
  el.echo.value = String(settings.echo);
  el.focus.checked = settings.focus;
  el.cues.checked = settings.cues;
  el.groupSize.value = String(settings.groupSize ?? 4);
  document.body.classList.toggle("focus", settings.focus);
  el.dimBtn.textContent = settings.dim ? "light" : "dim";
  document.body.classList.toggle("dim", settings.dim);
  el.style.value = settings.style;
  el.voice.value = settings.voiceURI;

  const params = new URLSearchParams(location.search);
  const wanted = params.get("s");

  if (wanted && /^[0-9a-f]{16}$/.test(wanted)) {
    loadScript(wanted);
    loadLibrary();
  } else {
    const stored = readStore(TEXT_KEY, "");
    if (stored) {
      el.source.value = stored;
      el.counts.textContent = `${countWords(stored)} words · ${stored.length} chars`;
      buildLocal(stored);
      setStatus(state.resumeNote ? `${state.resumeNote} — press play` : "restored last text — press play");
    } else {
      setStatus("ready");
    }
    loadLibrary();
  }

  checkHealth();
}

boot();
