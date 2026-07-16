# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

美瞳种草文案生成器 — a static, zero-build front-end web app that generates stylized Xiaohongshu (小红书) marketing copy for colored contact lenses, by calling an OpenAI-compatible LLM API **directly from the browser**. There is no framework, no bundler, no `package.json`, no Node. It runs by opening `index.html` (or serving the folder with any static server).

## Running

No build/test/lint step exists. To run:
- Open `index.html` directly in a browser, **or**
- Serve the folder: `python3 -m http.server` then visit the printed URL (needed for some browsers' clipboard / CORS behavior).

First use: expand "⚙️ API 设置" and fill Base URL + API Key + model (persisted to `localStorage`). Defaults assume DeepSeek (`https://api.deepseek.com/v1`, `deepseek-chat`).

## Architecture — the load order is load-bearing

`index.html` loads plain `<script>` tags in a fixed order. Each script attaches to `window` and depends on the ones before it; changing the order breaks the app:

```
styles/common.js          → window.COMMON + initializes window.STYLES = {}
styles/{ssorcon,sakura_blue,sakura_red}.js  → each adds window.STYLES[<key>]
evolve.js                 → window.EVOLVE (self-evolving vocab library; seeds from COMMON/STYLES at load)
prompt.js                 → window.PromptEngine (reads window.STYLES + window.COMMON + window.EVOLVE.sample at call time)
auth.js                   → trivial password gate
app.js                    → UI + the actual fetch; guards on window.PromptEngine existing; exposes window.callLLM for evolve.js
```

`evolve.js` MUST load after `styles/*.js` (it seeds from COMMON/STYLES) and before `prompt.js` (prompt.js calls `EVOLVE.sample` at generation time). `app.js` exposes `window.callLLM` which `evolve.js` uses for async library expansion at runtime.

Data flow for one generation (`app.js: generate()` → `PromptEngine.buildPrompt` → `callLLM` → `parseCopies` → `renderResults`):

1. **Style data lives in `styles/*.js`** as large hand-curated JSON-ish objects (one per writing "风格档"/style). Each style object holds: `vibe`, `titlePatterns`, `formulas`, `palette`, `persona`, `specs`, `praise`, `emojiCombos`, `signatures`, `homophones`, and a `fewShots` pool of real example copies. `window.COMMON` (in `common.js`) holds the style-agnostic engine: role, structure/punctuation rules, shared formulas, vocab, price hooks, emoji rules, and the `outputContract`.
2. **`prompt.js` assembles the prompt**: a `system` message stitched from COMMON + the selected style, and a `user` message carrying the user's `pastCopies` + `keywords`. Note it does a **Fisher–Yates shuffle of `fewShots` and samples 6** each call, so the model imitates different examples every time (avoids sameness).
3. **`app.js` calls `/chat/completions`** (OpenAI-compatible), parses the response, then `parseCopies` splits the markdown output (`# title` + 3–5 `> quote` lines, blocks separated by `---`) into `{title, lines}` cards.

### Style data files — the two formats are not equivalent

`styles/*.js` are the **runtime** files (loaded by the browser, schema: `label/vibe/formulas/palette/...`). `styles/*.json` are **not loaded anywhere** — they are raw extraction artifacts with a different schema (`vibeWords/colorWords/productWords/...`). The per-brand folders `ssorcon/`, `sakura_red/`, `sakura_blue/` hold the original human-written `参考文案.md` corpus that this data was distilled from (the source of the `fewShots`). When editing style behavior, edit the `.js`; the `.json`/`.md` are reference/source material.

## Hard constraints to preserve

- **产品参数红线 (product-parameter red line) — highest priority, do not weaken.** Throughout `prompt.js` the prompt forbids the model from fabricating any verifiable product fact (the product's real color name, diameter, price, 定轴/抛型/高光/度数, etc.) unless the user explicitly supplied it in `keywords` or `pastCopies`. Free-rein generation is limited to atmosphere/persona/emoji/praise. Seeing a parameter in the style pool or fewShots does **not** license using it. **Refinement for color:** `palette` is treated as an atmospheric *色感/氛围色词* vocabulary (copywriting color language, not the product's real colorway) — it is sampled + expandable, but generation may use a palette color word **only when it matches the user's stated product color family**; if the user gave no color, no specific color name may be invented. `specs`/`priceHooks`/`sharedPriceHooks` stay full-input and are never sampled or expanded. The self-evolving library (`evolve.js`) enforces this structurally: LLM expansion is scoped to atmosphere/persona/emoji/praise/sentence-shapes + `palette` color words; a `containsProductParam()` guard rejects any candidate carrying a diameter/price/款式/抛型/着色/度数 token (it deliberately does **not** reject color words, since palette candidates are color words).

## Self-evolving vocabulary library (`evolve.js`)

Solves long-run repetition without abandoning the inventory approach. Two tiers: a **library** in `localStorage` (`evolve_lib_v1`) that grows over time, and a **bounded weighted sample** passed to the prompt each call (so context never blows up no matter how large the library gets). Per item: `{id, payload (native shape), tier(seed|active|candidate), shown, copy, dislike, lastShownEpoch}`.

- **Weighted sample, not raw frequency** (avoids snowball): `weight = clamp( (dislike>0 ? 0.2 : 1 + copy*2 + (shown<3?4:0)) × recency(age), .2, 8 )`. A 👎 (`dislike>0`) **immediately floors** the item to weight 0.2 (rarely sampled, but not gone); recency (×0.2 if shown the previous generation) drives anti-repeat. `sample(catKey,k)` marks shown/epoch and returns native-shape payloads so the existing `joinArr`/`formulasBlock`/`homophonesBlock`/`fewShotsBlock` formatters are untouched.
- **Feedback = copy event.** `copyOne`/`copyAll` call `EVOLVE.recordCopy(text, style)` on success → substring-attributes the items actually exposed that generation (`copy++`, and **clears `dislike`** — a copy is a rescue that undoes prior 👎 demerits) → `curate()`.
- **Candidate gate** (auto-promote + 👎 demote): candidates auto-promote to `active` at `shown≥3 && copy≥1`, auto-evict when tried with zero copy; `seed` tier (the original COMMON/STYLES items) is never evicted (anchors brand identity). A 👎 button per result card calls `banCard` → **graduated, not instant**: it picks the single longest-matching exposed item and does `dislike++` (which floors weight to 0.2); only when the same item accumulates `dislike≥2` does its canonical text enter `blacklist` (filtered from sampling; candidate then dropped). So one 👎 suppresses without banning; two 👎 ban; a copy rescues (clears dislike).
- **Async expansion** runs at **generate time** (fired fire-and-forget alongside the main call, throttled 60s), reusing `window.callLLM`; rotates one red-line-safe category per call. Triggering on generate (not on copy) is deliberate — the user is guaranteed to be on the page while generation runs, so the expand call completes before they copy and leave (a post-copy async call could be killed by page unload).
- `prompt.js` wraps each dynamic category with `pick(catKey, fallback, k)` (falls back to the full original array if `EVOLVE` is absent). Dynamic (sampled + expandable) categories: `sharedFormulas`/`sharedVocab`/`homophones` + per-style `formulas`/`signatures`/`titlePatterns`/`praise`/`persona`/`emojiCombos`/`fewShots`/`palette`. `specs`/`priceHooks`/`sharedPriceHooks` stay full-input and are never sampled or expanded.
- **Deliberately avoid `??` and `?.`** (and lean on `var`/`function`/IIFEs/`Array.prototype.forEach.call`). The top comment in `app.js` states this is for broad browser-kernel compatibility — don't introduce modern syntax when editing these files.
- **`auth.js` is not real security** — it's a base64-obfuscated password stored in source (`PASSWORD_B64`, currently `btoa`-encoded). To change the password: run `btoa('新密码')` in a browser console and replace that constant. Don't treat it as authn or move real secrets here. Login state persists in `localStorage` (`auth_ok=1`).

## Key runtime values (in `app.js`)

- `temperature` default `0.95` (user-adjustable slider 0–1.5, also in `buildPrompt`).
- `max_tokens = min(8000, count*600 + 200)`; request aborts after 90s.
- `buildUrl()` normalizes the Base URL: accepts `/v1` (appends `/chat/completions`) or a full `/chat/completions`; bare domain → `/v1/chat/completions`.
- `localStorage` keys: `baseUrl`, `apiKey`, `model`, `style`, `count`, `temperature`, `auth_ok`.
