// reader/extract.mjs
// File -> readable text. Text/markdown read in the browser; PDF, DOCX and photos
// come here. Photos go through tesseract (installed locally). No network call.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

const run = promisify(execFile);

const TEMP_ROOT = process.env.XDG_RUNTIME_DIR || "/tmp/opencode";
const MAX_PDF_STREAMS = 300;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 80_000;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"]);

function extensionOf(name) {
  return String(name || "").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanText(text) {
  return String(text || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/** Inflate PDF streams and pull text out of BT/ET blocks. */
function extractPdf(buffer) {
  const raw = buffer.toString("latin1");
  const blocks = [];
  const streamRe = /stream\r?\n/g;
  let match;
  let streams = 0;

  while ((match = streamRe.exec(raw)) !== null && streams < MAX_PDF_STREAMS) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;

    const chunk = Buffer.from(raw.slice(start, end), "latin1");
    if (chunk.length > MAX_PDF_BYTES) continue;
    streams += 1;

    let inflated;
    try {
      inflated = inflateSync(chunk);
    } catch {
      // Some PDFs embed uncompressed content streams.
      inflated = chunk;
    }

    const text = inflated.toString("latin1");
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
          const hexValue = value.slice(1, -1).replace(/\s/g, "");
          const bytes = Buffer.from(hexValue, "hex");
          value = bytes.includes(0) ? bytes.toString("utf16le") : bytes.toString("latin1");
        }

        // TCPDF and friends write ASCII as UTF-16LE with null bytes.
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
    // Subset-font streams decode to noise — keep readable words only.
    return printable / line.length > 0.9 && letters / line.length > 0.4;
  });

  const text = cleanText(useful.join("\n"));
  return {
    text,
    method: "pdf-text",
    warning: /[A-Za-z]{3}/.test(text)
      ? ""
      : "No selectable text in this PDF — it is probably scanned. Export a page as a photo and upload that instead.",
  };
}

/** DOCX is a zip; python's stdlib is enough to pull word/document.xml. */
async function extractDocx(file) {
  const script = [
    "import sys, zipfile, re, html",
    "d=zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode('utf8','ignore')",
    "d=re.sub(r'</w:p>','\\n',d)",
    "d=re.sub(r'<[^>]+>','',d)",
    "print(html.unescape(d))",
  ].join("; ");

  try {
    const { stdout } = await run("python3", ["-c", script, file], { timeout: 20_000 });
    return cleanText(stdout);
  } catch {
    return "";
  }
}

async function tesseractPass(file, psm) {
  try {
    const { stdout } = await run("tesseract", [file, "stdout", "-l", "eng", "--psm", String(psm)], {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return cleanText(stdout);
  } catch {
    return "";
  }
}

/** Two layouts, keep the one that produced more words. */
async function extractImage(file) {
  const block = await tesseractPass(file, 6);
  const page = await tesseractPass(file, 3);
  const score = (text) => (text.match(/[A-Za-z0-9]/g) || []).length;
  const best = score(block) >= score(page) ? block : page;
  if (!best) return { error: "photo reading failed — no text found" };
  return best;
}

/**
 * Extract readable text from an uploaded file.
 * @returns {Promise<{text:string, method:string, warning:string}>}
 */
export async function extractFile(name, buffer) {
  const ext = extensionOf(name);
  if (!buffer?.length) return { text: "", method: "empty", warning: "empty file" };

  if (IMAGE_EXT.has(ext)) {
    const dir = await mkdtemp(join(TEMP_ROOT, "readslow-"));
    const file = join(dir, `photo.${ext}`);
    try {
      await writeFile(file, buffer);
      const result = await extractImage(file);
      if (result.error) return { text: "", method: "ocr", warning: result.error };
      return {
        text: result,
        method: "ocr",
        warning: result ? "" : "No words found in the photo. Try a sharper, well-lit image.",
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  if (ext === "pdf") return extractPdf(buffer);

  if (ext === "docx") {
    const dir = await mkdtemp(join(TEMP_ROOT, "readslow-"));
    const file = join(dir, "doc.docx");
    try {
      await writeFile(file, buffer);
      const text = await extractDocx(file);
      return {
        text,
        method: "docx",
        warning: text ? "" : "Could not read this docx.",
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return {
    text: cleanText(buffer.toString("utf8")),
    method: "text",
    warning: "",
  };
}
