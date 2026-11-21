# ReadSlow

A calm AI reader for studying. It splits text into breath-sized phrases, reads them slowly in a natural voice, and repeats any phrase — or just the last three words — the moment you miss something.

Built for the case where a lecture or a chapter runs faster than your hand. The reader waits. You write. If you fall behind, hit repeat.

## Run

```bash
cd reader
node server.mjs
```

Open <http://localhost:8787>.

No install step. No dependencies. Node 20+.

## The AI provider

The server reads the cent provider straight out of your opencode config, so there is no key to paste:

1. `CENT_API_KEY` / `CENT_BASE_URL` / `CENT_MODEL` from the environment
2. the same names from `reader/.env`
3. `~/.config/opencode/opencode.jsonc` → provider `cent-ai` → `hy4-flash:free`

Copy `.env.example` to `.env` only if you want to override something. Without a key the app still works — it chunks locally and speaks through the browser voice.## What it does

- **Breath-sized phrases.** 4–13 words per phrase, split at commas, conjunctions, and natural seams. Never mid-name, mid-number, mid-formula.
- **Calm pace.** Default 0.85× speed with a per-phrase pause scaled to the punctuation. Both are adjustable.
- **Repeat controls.** Repeat the current phrase, repeat the last three words, or repeat the phrase slowly. Click any word to start reading from there.
- **Echo mode.** Read every phrase once, twice, or three times before moving on.
- **Voice commands.** Turn on `voice` and say *repeat*, *slower*, *three words*, *pause*, *next*, *back*, *play*.
- **AI prep.** The `Prep with AI` button sends the text through the cent provider with the reading skill in `skill/reading-skill.md`: it sets phrasing, pause lengths, emphasis, and a title. Long text is batched; a failed batch falls back to local chunking instead of failing the request.
- **Focus mode.** Everything but the current phrase dims. `dim` switches the room to dark.
- **Restores your text and settings** from localStorage on the next visit, and resumes at the phrase you stopped on.

## Pre-prep before the session

The model call takes a few seconds per ~1,300 characters. Do it once, ahead of time, and playback starts instantly:

```bash
cd reader

# prep a chapter for tonight
node prep.mjs photosynthesis.txt --style study

# prep from a pipe
cat notes.md | node prep.mjs --style exam

# see everything you've prepped
node prep.mjs --list
```

Each run writes `reader/scripts/<id>.json`. Open it in the app with `http://localhost:8787/?s=<id>`, or pick it from the **Saved** list in the sidebar. Hitting `Prep with AI` on the same text reuses the saved script instantly — no model call, no wait. The same cache backs `/api/prep`, so the button and the CLI share one library.

## AI editing pass

`AI Edit` in the sidebar runs the text through the model before the reading prep. It fixes OCR mistakes, broken hyphens, bad spacing and missing punctuation, deletes page numbers and textbook footers, and rejoins wrapped lines. It never summarizes, translates or adds words — and it refuses an edit that changes the word count by more than 50%, keeping your original instead.

On a photo or document, the flow is now: vision read → AI edit → AI prep → play. The same pass is available in the CLI:

```bash
node prep.mjs page.txt --edit --style study
```

Edits are cached by content hash in `reader/edits/`, so the second run is instant.

## Photos, PDFs and uploads

Drop files anywhere on the page, click **Upload / photo**, or paste a screenshot with `Ctrl+V`.

- `.txt`, `.md`, `.csv`, `.json` — read in the browser, instant
- `.pdf` — text extracted from the PDF's own text layer
- `.docx` — paragraph text pulled out of the document
- photos (`png`, `jpg`, `webp`, `gif`, `bmp`, `tiff`) — read by the **vision model first** (hy4 reads handwriting and non-Latin scripts), with local `tesseract` as the offline fallback

Photos and documents are auto-prepped with AI after extraction, so the calibrated reading script is ready when the file finishes uploading. If a word comes out wrong, edit the text in the Source box and hit **Re-chunk**. Scanned PDFs have no text layer: export one page as a photo and upload that instead.

`POST /api/upload` takes `{ "name": "page.png", "data": "<base64>" }` and returns `{ text, method, warning }`. 12 MB per file, OCR runs locally, nothing leaves the machine except the text you choose to prep.

## Public URL (Cloudflare)

```bash
# in a second terminal
cloudflared tunnel --url http://localhost:8787 --no-autoupdate
# or: npm run tunnel
```

It prints a random `https://<words>.trycloudflare.com` URL. Share that with a phone or another student; no port forwarding and no account needed. The URL lives only while the tunnel process is running.

Keep the URL to yourself — anyone holding it can call `/api/prep` against your cent key. The server rate-limits prep to 12 requests per minute per client.

## Shortcuts

| Key | Action |
| --- | --- |
| `space` | play / pause |
| `R` | repeat current phrase |
| `W` | repeat last three words |
| `S` | repeat current phrase slowly |
| `E` | AI Edit + prep |
| `C` | toggle line cues |
| `←` `→` | previous / next phrase |
| `+` `-` | speed up / slow down |
| `Esc` | pause |

## API

`GET /api/health` → `{ ok, ai, provider, model, keySource }`

`POST /api/prep` → `{ text, style }` where style is `study`, `exam`, or `story`. Cached by content hash; add `"force": true` to re-run the model.

```json
{
  "id": "a1b2c3d4e5f60718",
  "title": "Photosynthesis",
  "chunks": [{ "text": "…", "pauseMs": 600, "emphasis": ["powerhouse"] }],
  "meta": { "source": "ai", "batches": 2, "failedBatches": 0, "cached": false }
}
```

`GET /api/scripts` → every saved prep. `GET /api/scripts/<id>` → one full script (with source text).

## Files

```
reader/
  index.html            layout
  styles.css            warm paper theme, focus/dim modes
  app.js                playback engine, repeats, voice commands, AI prep
  chunk.js              shared phrase chunker (browser + server)
  extract.mjs             file -> text: tesseract OCR, PDF text layer, docx
  prep-core.mjs         prep pipeline: provider config, batching, script storage
  prep.mjs              CLI — pre-prep scripts before a session, list the library
  server.mjs            static server + prep endpoints
  scripts/              saved reading scripts (JSON, one per text)
  skill/reading-skill.md  the pro reading prompt sent to the model
```

## Notes

- Speech uses the browser's `speechSynthesis`. Chrome and Edge have the best voices; the voice list is whatever the system exposes.
- The first `Play` has to be a click — browsers block autoplay audio.
- AI prep costs one model call per ~1,300 characters, capped at 48 batches per request and 12 requests per minute. Thinking is disabled on the model — leaving it on makes hy4 burn its whole token budget reasoning and return nothing.
