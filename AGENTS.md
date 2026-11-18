# AGENTS.md

Static website for Deep Proof, served from `docs/` (GitHub Pages). No build step: plain HTML, `styles.css`, `script.js`.

## Text and translations

The site is available in English (default), German, French, Italian, Romansh, Spanish, Dutch, Polish, Portuguese and Romanian. Every visible text lives in key/value files:

- `docs/i18n/en.js`, `de.js`, `fr.js`, `it.js`, `rm.js`, `es.js`, `nl.js`, `pl.js`, `pt.js`, `ro.js`: `window.DP_I18N.<lang> = { "key": "value" }`. Values may contain inline HTML (`<em>`, `<br />`, `<strong>`, `<a>`, `<span>`).
- In the HTML pages, elements carry `data-i18n="key"` (inner HTML) or `data-i18n-attr="attr:key;attr2:key2"` (attributes such as `aria-label`, `placeholder`, meta `content`). The English text stays in the HTML as the no-JS fallback.
- Strings produced by `script.js` use `t("js_…")` keys (story labels, Pause/Play, theme labels, AI Review Skill previews, copy messages).
- They are plain scripts, not ES modules, so the site also works when opened from disk (`file://`).

**Rule: every text change must be propagated to all translation files.** When you add, change or remove a text:

1. Change the English in the HTML **and** in `docs/i18n/en.js` (same key).
2. Apply the equivalent change in `de.js`, `fr.js`, `it.js`, `rm.js`, `es.js`, `nl.js`, `pl.js`, `pt.js` and `ro.js` in the same commit. Never leave a language with the old meaning or a missing key.
3. New element: add `data-i18n` with a new key, and add that key to all ten files.
4. Run `node tools/check-i18n.js docs`. It must print `OK` for de, fr, it, rm, es, nl, pl, pt and ro (same keys, same HTML tags per value).
5. Check that large titles still fit on at most two lines in every language: open a page with `?lang=de`, `?lang=fr`, `?lang=it`, `?lang=rm`, `?lang=es`, `?lang=nl`, `?lang=pl`, `?lang=pt`, `?lang=ro`.

### Translation conventions

- Keep untranslated: Deep Proof, AI Review Skill(s), Community Edition, GPL-3.0, Outfinity SARL, Outfinity Venture Studio, Axiologic Research, GitHub, ChatGPT, Claude.
- Spell the label "Open-Source" with a hyphen.
- German: Swiss orthography (never `ß`, always `ss`), formal "Sie", Swiss terms (Entscheid, DSG, EDÖB).
- French and Italian: formal register, Swiss usage (LPD, PFPDT / IFPDT).
- Romansh: Rumantsch Grischun (standard written Romansh), formal register ("Vus", capitalised "Voss/Vossa"), Swiss legal terms (LPD, RGPD, IFPDT).
- Spanish: formal "usted", neutral (Spain) business Spanish; Swiss law as "LPD" (Ley Federal suiza de Protección de Datos), FDPIC glossed, EU law as RGPD.
- Dutch: formal "u/uw"; Swiss law as "nDSG", FDPIC glossed, EU law as AVG.
- Polish: formal "Państwo/Państwa"; titles and buttons in impersonal or nominal form (no informal "ty" imperatives); Swiss law as "nDSG", FDPIC glossed, EU law as RODO.
- Portuguese: European Portuguese (equipa, ficheiro, utilizador, contacto), current orthography, formal/impersonal; Swiss law as "LPD", FDPIC glossed, EU law as RGPD.
- Romanian: formal "dumneavoastră", diacritics with comma below (ș, ț, never cedilla ş, ţ; the checker rejects them); Swiss law as "LPD", FDPIC glossed, EU law as RGPD.
- Adding a language: new `docs/i18n/<lang>.js`, a `<option>` in the language selector (options sorted alphabetically by code) and the language code in the head script regexes of every page, and the code in `tools/check-i18n.js`.
- Titles with `<br />` keep exactly one `<br />`, placed after the first sentence in that language.

## Articles

- An article page is any `docs/*.html` that holds an `<!-- ARTICLE:BEGIN` marker; there can be any number of them (today `docs/ai-agents-misread-long-documents.html`). Each holds an article between `<!-- ARTICLE:BEGIN sha256=<hex> -->` and `<!-- ARTICLE:END -->`. The article body is **English only**, a documented exception to the translation rule above: it carries no `data-i18n` and is not in the `i18n` files. The page frame (header, footer, the English note, the report form, its consent text and messages) is translated like every other text.
- `docs/articles.html` is the index the "Articles" tab of the header opens (the tab follows "Open-Source" on every page). Each article page has exactly one entry, and its summary key is the one on that entry. The entry shows the article's title in English, as a link with `lang="en"` and no `data-i18n` (part of the same English-only exception; it must equal the article's `<h1>`), and a one-sentence summary that is translated like every other text (`art_misread_summary` for the first article; a new article adds its own key to all ten files). A summary stays inside what the article says and carries no number, rate or claim about a named model; `check-article.js` refuses a digit in any language.
- The body is generated in the testing-docs repository (`article/build_article.py --final --out FILE`, which prints the fragment's sha256) and inserted with `node tools/insert-article.js FILE --expect <sha256>`; `--page docs/NAME.html` names the page and is required when more than one article page exists. Never edit the text between the markers by hand.
- `node tools/check-article.js docs` checks every article page and must exit 0 before a page is published; `--page NAME --expect <sha256>` binds that page's marker to the builder's hash (`--expect` alone works while there is one article page). For each page: marker hash, no `data-i18n`, address, script, form or DRAFT mark inside the fragment; if the page has a `report-request-form`: the form's fields, a `data-document` matching the document id pattern, keys and accessibility ties (consent box named by the consent text; trap field `aria-hidden`, `inert`, `tabindex="-1"`), `report-form.js` loaded after `script.js` and a set consent version in `docs/report-form.js`; if it has no form: no `report-form.js`. And the index: `noindex` on both pages until go-live, the title equal to the article's `<h1>`, the summary in every language, and the Articles tab on every page. At go-live, removing `noindex` needs the matching check in `checkIndex` changed in the same commit.
- Pages load `tracking.js`, which fetches the analytics script from bizanso.com. Local browser checks of these pages must block that host (for example CDP `Network.setBlockedURLs`), or every page load counts as a visit. `node tools/check-article.js --self-test` and `node tools/test-report-form.js` test the tools and the form script.
- The report form posts to Bizanso (the collector address, site, form and consent version are constants at the top of `docs/report-form.js`). A new consent text needs a new consent version, registered in Bizanso before the page shows it.
- The one value that differs per page is the document the form asks for: `data-document="<id>"` on the `<form id="report-request-form">`, an id matching `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`. Without a valid id the form shows "unavailable" and sends nothing. `report-form.js` uses `t()` and `currentLang` of `script.js` when they exist and built-in English and the page's `lang` attribute when they do not, so another website can copy the file.

## Other conventions

- The contact email address never appears as text in the source. It is assembled in `script.js` and drawn as an SVG (`.email-img`, `data-mail` links).
- Light theme is the default; theme and language choices are stored in `localStorage` (`theme`, `lang`).
- Descriptive paragraphs are justified; titles stay on at most two lines.
