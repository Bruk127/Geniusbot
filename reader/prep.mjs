#!/usr/bin/env node
// reader/prep.mjs
// Pre-prep CLI: turn a file (or stdin) into a stored reading script BEFORE the
// study session, so playback starts instantly. Works offline from the cache.

//   node prep.mjs chapter.txt                # style: study
//   node prep.mjs notes.md --style exam
//   node prep.mjs story.txt --style story --title "The River"
//   node prep.mjs chapter.txt --force        # re-run the model even if cached
//   node prep.mjs --list
//   cat notes.txt | node prep.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AI, editText, listScripts, prepareText, scriptId } from "./prep-core.mjs";
import { stripMarkup } from "./chunk.js";

function parseArgs(argv) {
  const args = { style: "study", force: false, list: false, edit: false, title: "", files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--style" || arg === "-s") args.style = argv[++i] || "study";
    else if (arg === "--title" || arg === "-t") args.title = argv[++i] || "";
    else if (arg === "--force" || arg === "-f") args.force = true;
    else if (arg === "--edit" || arg === "-e") args.edit = true;
    else if (arg === "--list" || arg === "-l") args.list = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else args.files.push(arg);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`readslow prep — pre-prep a reading script

  node prep.mjs <file...> [--style study|exam|story] [--title "..."] [--edit] [--force]
  cat file | node prep.mjs
  node prep.mjs --list

Scripts are stored in reader/scripts/<id>.json and reused instantly.
`);
  process.exit(0);
}

if (args.list) {
  const scripts = listScripts();
  if (!scripts.length) {
    console.log("no scripts yet — run: node prep.mjs yourfile.txt");
    process.exit(0);
  }
  console.log(`${scripts.length} script(s):\n`);
  for (const script of scripts) {
    console.log(`  ${script.id}  ${script.title}`);
    console.log(`          ${script.words} words · ${script.chunks} phrases · ${script.style} · ${script.source} · ${String(script.created).slice(0, 16).replace("T", " ")}`);
  }
  console.log(`\nopen one at  /?s=<id>   e.g. http://localhost:8787/?s=${scripts[0].id}`);
  process.exit(0);
}

let text = "";
if (args.files.length) {
  for (const file of args.files) {
    try {
      text += `${readFileSync(resolve(file), "utf8")}\n\n`;
    } catch (error) {
      console.error(`cannot read ${file}: ${error.message}`);
      process.exit(1);
    }
  }
} else if (!process.stdin.isTTY) {
  text = readFileSync(0, "utf8");
}

text = stripMarkup(text);
if (!text) {
  console.error("no text given — pass a file or pipe text in");
  process.exit(1);
}

const words = text.split(/\s+/).filter(Boolean).length;
console.log(`[readslow] ${words} words · style ${args.style} · id ${scriptId(text, args.style)}`);
console.log(`[readslow] model ${AI.model} (${AI.source === "none" ? "no key — local only" : AI.source})`);

if (args.edit) {
  try {
    const edited = await editText(text);
    console.log(`[readslow] AI edit: ${edited.beforeWords} → ${edited.afterWords} words · ${edited.cached ? "cached" : "ai"}`);
    text = edited.text;
  } catch (error) {
    console.error(`[readslow] AI edit failed, using original text: ${error.message}`);
  }
}

const t0 = Date.now();
try {
  const script = await prepareText(text, {
    style: args.style,
    force: args.force,
    title: args.title,
  });

  const meta = script.meta || {};
  const ms = meta.ms || Date.now() - t0;
  const engine = meta.source === "ai" ? `${script.model} ai` : "local chunking";
  console.log(`[readslow] ${script.chunks.length} phrases via ${engine} in ${(ms / 1000).toFixed(1)}s`);
  if (meta.failedBatches) console.log(`[readslow] ${meta.failedBatches}/${meta.batches} batches fell back to local chunking`);
  if (meta.tailChunks) console.log(`[readslow] ${meta.tailChunks} tail phrases chunked locally`);
  console.log(`[readslow] saved → reader/scripts/${script.id}.json`);
  console.log(`[readslow] open → http://localhost:8787/?s=${script.id}`);
} catch (error) {
  console.error(`[readslow] prep failed: ${error.message}`);
  process.exit(1);
}
