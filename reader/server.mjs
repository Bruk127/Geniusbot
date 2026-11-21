// reader/server.mjs
// Zero-dependency server: static files + prep endpoints backed by prep-core.mjs.
// Node 20+.  `node server.mjs`

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AI, editText, listScripts, loadScript, prepareText, readPhoto, scriptId } from "./prep-core.mjs";
import { countWords, stripMarkup } from "./chunk.js";
import { extractFile } from "./extract.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

const MAX_BODY = 200_000;
const MAX_UPLOAD_BODY = 20 * 1024 * 1024;
const MAX_UPLOAD_FILE = 12 * 1024 * 1024;
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function mimeOf(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  const map = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
  };
  return map[ext] || "image/png";
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readJson(req, limit = MAX_BODY) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const parts = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on("end", () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("invalid json body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

// ----------------------------------------------------------------------- prep

const rateBuckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  if (rateBuckets.size > 500) {
    for (const [key, times] of rateBuckets) {
      if (!times.some((t) => now - t < RATE_WINDOW_MS)) rateBuckets.delete(key);
    }
  }
  return bucket.length > RATE_LIMIT;
}

function publicScript(script) {
  // Never ship the source text back — the browser still has it in the textarea.
  const { source, ...rest } = script;
  return rest;
}

async function handlePrep(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) return send(res, 429, { error: "slow down — 12 preps per minute" });

  const body = await readJson(req);
  const raw = String(body.text ?? "");
  if (!raw.trim()) return send(res, 400, { error: "text is empty" });

  const clean = stripMarkup(raw);
  if (!clean) return send(res, 400, { error: "nothing to read after cleanup" });

  const script = await prepareText(raw, {
    style: body.style,
    force: body.force === true,
  });

  return send(res, 200, publicScript(script));
}

// --------------------------------------------------------------------- static

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, { error: "bad path" });
  }

  const relative = pathname === "/" ? "/index.html" : pathname;
  const file = resolve(ROOT, `.${relative}`);

  if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, { error: "forbidden" });

  try {
    const info = await stat(file);
    if (!info.isFile()) return send(res, 404, { error: "not found" });
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    res.end(body);
  } catch {
    send(res, 404, { error: "not found" });
  }
}

// --------------------------------------------------------------------- server

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");

  try {
    if (url.pathname === "/api/health" && req.method === "GET") {
      return send(res, 200, {
        ok: true,
        ai: Boolean(AI.apiKey),
        provider: "cent-ai",
        model: AI.model,
        keySource: AI.source,
      });
    }

    if (url.pathname === "/api/prep" && req.method === "POST") {
      return await handlePrep(req, res);
    }

    if (url.pathname === "/api/edit" && req.method === "POST") {
      if (rateLimited(req.socket.remoteAddress || "unknown")) {
        return send(res, 429, { error: "slow down — 12 calls per minute" });
      }
      const body = await readJson(req);
      const raw = String(body.text ?? "");
      if (!raw.trim()) return send(res, 400, { error: "text is empty" });
      return send(res, 200, await editText(raw));
    }

    if (url.pathname === "/api/upload" && req.method === "POST") {
      const body = await readJson(req, MAX_UPLOAD_BODY);
      const data = body.data;
      const name = String(body.name || "upload");

      if (typeof data !== "string" || !data || !/^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 200))) {
        return send(res, 400, { error: "expected base64 data" });
      }

      const file = Buffer.from(data.replace(/\s/g, ""), "base64");
      if (!file.length) return send(res, 400, { error: "empty file" });
      if (file.length > MAX_UPLOAD_FILE) {
        return send(res, 413, { error: "file too large — 12 MB max" });
      }

      let result;

      // Vision model first — it reads handwriting and non-Latin scripts that
      // local OCR misses. Tesseract is the offline fallback.
      const isPhoto = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name) || file.slice(0, 4).toString("hex").startsWith("89504e47");
      let aiWarning = "";

      if (isPhoto && file.length <= 6 * 1024 * 1024 && AI.apiKey) {
        try {
          result = {
            text: await readPhoto(file, mimeOf(name)),
            method: "ai-vision",
            warning: "",
          };
        } catch (error) {
          aiWarning = `AI photo read failed (${String(error.message).slice(0, 90)}) — used local OCR`;
        }
      }

      if (!result || !String(result.text || "").trim()) {
        const local = await extractFile(name, file);
        result = { ...local, warning: local.warning || aiWarning };
      }

      return send(res, 200, { name, bytes: file.length, ...result });
    }

    if (url.pathname === "/api/scripts" && req.method === "GET") {
      return send(res, 200, { scripts: listScripts() });
    }

    const scriptMatch = url.pathname.match(/^\/api\/scripts\/([0-9a-f]{16})$/);
    if (scriptMatch && req.method === "GET") {
      const script = loadScript(scriptMatch[1]);
      if (!script) return send(res, 404, { error: "script not found" });
      return send(res, 200, script);
    }

    if (url.pathname.startsWith("/api/")) {
      return send(res, 404, { error: "unknown endpoint" });
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { error: "method not allowed" });
    }

    return await serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error("[readslow]", error);
    if (!res.headersSent) send(res, status, { error: error.message || "server error" });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  const where = AI.source === "none" ? "no key found — local chunking only" : AI.source;
  console.log(`[readslow] model ${AI.model} · ${where}`);
  console.log(`[readslow] http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
