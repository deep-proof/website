# AGENTS.md

Static website for Deep Proof, served from `docs/` (GitHub Pages). No build step: plain HTML, `styles.css`, `script.js`.

## Text and translations

The site is available in English (default), German, French, Italian and Romansh. Every visible text lives in key/value files:

- `docs/i18n/en.js`, `de.js`, `fr.js`, `it.js`, `rm.js`: `window.DP_I18N.<lang> = { "key": "value" }`. Values may contain inline HTML (`<em>`, `<br />`, `<strong>`, `<a>`, `<span>`).
- In the HTML pages, elements carry `data-i18n="key"` (inner HTML) or `data-i18n-attr="attr:key;attr2:key2"` (attributes such as `aria-label`, `placeholder`, meta `content`). The English text stays in the HTML as the no-JS fallback.
- Strings produced by `script.js` use `t("js_…")` keys (story labels, Pause/Play, theme labels, AI Review Skill previews, copy messages).
- They are plain scripts, not ES modules, so the site also works when opened from disk (`file://`).

**Rule: every text change must be propagated to all translation files.** When you add, change or remove a text:

1. Change the English in the HTML **and** in `docs/i18n/en.js` (same key).
2. Apply the equivalent change in `de.js`, `fr.js`, `it.js` and `rm.js` in the same commit. Never leave a language with the old meaning or a missing key.
3. New element: add `data-i18n` with a new key, and add that key to all five files.
4. Run `node tools/check-i18n.js docs`. It must print `OK` for de, fr, it and rm (same keys, same HTML tags per value).
5. Check that large titles still fit on at most two lines in every language: open a page with `?lang=de`, `?lang=fr`, `?lang=it`, `?lang=rm`.

### Translation conventions

- Keep untranslated: Deep Proof, AI Review Skill(s), Community Edition, GPL-3.0, Outfinity SARL, Outfinity Venture Studio, Axiologic Research, GitHub, ChatGPT, Claude.
- Spell the label "Open-Source" with a hyphen.
- German: Swiss orthography (never `ß`, always `ss`), formal "Sie", Swiss terms (Entscheid, DSG, EDÖB).
- French and Italian: formal register, Swiss usage (LPD, PFPDT / IFPDT).
- Romansh: Rumantsch Grischun (standard written Romansh), formal register ("Vus", capitalised "Voss/Vossa"), Swiss legal terms (LPD, RGPD, IFPDT).
- Adding a language: new `docs/i18n/<lang>.js`, a `<option>` in the language selector and the language code in the head script regexes of every page, and the code in `tools/check-i18n.js`.
- Titles with `<br />` keep exactly one `<br />`, placed after the first sentence in that language.

## Other conventions

- The contact email address never appears as text in the source. It is assembled in `script.js` and drawn as an SVG (`.email-img`, `data-mail` links).
- Light theme is the default; theme and language choices are stored in `localStorage` (`theme`, `lang`).
- Descriptive paragraphs are justified; titles stay on at most two lines.
