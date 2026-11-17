// Checks the article page (plan I9, I11; acceptance B2).
// Usage: node tools/check-article.js docs [--expect <sha256>]
//        node tools/check-article.js --self-test
// Exits 0 when every check passes, 1 when one fails, 2 on a usage error.
//
// The fragment is the text strictly between the line of
//   <!-- ARTICLE:BEGIN sha256=<hex> -->
// (after its newline) and the start of <!-- ARTICLE:END -->. Its sha256 must equal the
// marker's, and, when --expect is given, the hash that build_article.py --final printed.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PAGE = "ai-agents-misread-long-documents.html";
const INDEX = "articles.html";
const SUMMARY_KEY = "art_misread_summary";
const LANGS = ["en", "de", "es", "fr", "it", "nl", "pl", "pt", "rm", "ro"];
const BEGIN_RE = /<!-- ARTICLE:BEGIN sha256=([0-9a-f]{64}) -->\n/g;
const END_MARK = "<!-- ARTICLE:END -->";
const OPEN_TAG = '<article lang="en" class="article-copy">';
const FORM_FIELDS = ["name", "email", "company", "comment", "website", "consent"];
const PAGE_KEYS = ["art_english_note", "test_results", "rf_heading", "rf_intro", "rf_name", "rf_email", "rf_company", "rf_comment", "rf_consent", "rf_submit"];
const SCRIPT_KEYS = ["js_rf_sending", "js_rf_success", "js_rf_expires", "js_rf_no_email", "js_rf_copy", "js_rf_copied", "js_rf_invalid", "js_rf_field_required", "js_rf_field_email", "js_rf_field_long", "js_rf_consent_required", "js_rf_rate_limited", "js_rf_unavailable", "js_copy_failed"];
const SCRIPT_IDS = ["report-request-form", "rf-submit", "rf-status", "rf-result", "rf-success", "rf-link", "rf-expires", "rf-no-email", "rf-copy", "rf-error-name", "rf-error-email", "rf-error-company", "rf-error-comment", "rf-error-consent"];
// Refused inside the fragment. Kept in step with build_article.py's refusals (plan I11).
const FRAGMENT_RULES = [
  ["data-i18n attribute", /data-i18n/i],
  ["data-mail attribute", /data-mail/i],
  ["mailto link", /mailto:/i],
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ["script element", /<script/i],
  ["form element", /<form/i],
  ["style element", /<style/i],
  ["iframe element", /<iframe/i],
  ["event handler attribute", /<[a-z][^>]*\son[a-z]+\s*=/i],
  ["forbidden phrase 'at least 30'", /at least 30/i],
  ["forbidden phrase '30%'", /(?<![\d.,])30(?:\.0)?\s?%/i],
  ["forbidden phrase '30 per cent'", /30 per ?cent/i],
  ["forbidden phrase 're-worded'", /re-?worded/i],
  ["forbidden phrase 'pilotrewords'", /pilotrewords/i],
  ["forbidden phrase 'dorna'", /dorna/i],
  ["forbidden phrase 'ca-trick'", /ca-trick/i],
  ["edition 8 rate '29.3'", /29\.3/]
];
const DRAFT_RE = /\bDRAFT\b/;

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// Finds the markers. Returns { fragment, hash, start, end } or { error }.
function locateFragment(html) {
  const begins = [...html.matchAll(BEGIN_RE)];
  const loose = (html.match(/ARTICLE:BEGIN/g) || []).length;
  if (begins.length !== 1 || loose !== 1) return { error: "expected exactly one '<!-- ARTICLE:BEGIN sha256=<64 hex> -->' line, found " + loose };
  const ends = html.split(END_MARK).length - 1;
  if (ends !== 1 || (html.match(/ARTICLE:END/g) || []).length !== 1) return { error: "expected exactly one '" + END_MARK + "', found " + ends };
  const start = begins[0].index + begins[0][0].length;
  const end = html.indexOf(END_MARK);
  if (end < start) return { error: "ARTICLE:END comes before ARTICLE:BEGIN" };
  return { fragment: html.slice(start, end), hash: begins[0][1], start, end };
}

// Checks of the fragment alone. allowDraft is used by insert-article.js only.
function checkFragment(fragment, { allowDraft = false } = {}) {
  const problems = [];
  const body = fragment.trim();
  if (!body.startsWith(OPEN_TAG)) problems.push("fragment does not start with " + OPEN_TAG);
  if (!body.endsWith("</article>")) problems.push("fragment does not end with </article>");
  if ((body.match(/<article\b/g) || []).length !== 1) problems.push("fragment must hold exactly one <article>");
  for (const [label, re] of FRAGMENT_RULES) if (re.test(fragment)) problems.push("fragment holds a " + label);
  if (!allowDraft && DRAFT_RE.test(fragment)) problems.push("fragment holds the DRAFT mark: insert the --final fragment");
  return problems;
}

function loadLanguage(docsDir, lang) {
  const sandbox = { window: {} };
  const code = fs.readFileSync(path.join(docsDir, "i18n", lang + ".js"), "utf8");
  new Function("window", code)(sandbox.window);
  return sandbox.window.DP_I18N[lang];
}
function loadEnglish(docsDir) { return loadLanguage(docsDir, "en"); }

const plainText = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// The articles index (articles.html) and the Articles tab of every page.
function checkIndex(docsDir, fragment) {
  const problems = [];
  let html;
  try { html = fs.readFileSync(path.join(docsDir, INDEX), "utf8"); } catch (error) { return ["cannot read " + INDEX]; }
  for (const [name, page] of [[INDEX, html], [PAGE, null]]) {
    let text = page;
    if (text === null) { try { text = fs.readFileSync(path.join(docsDir, PAGE), "utf8"); } catch (error) { continue; } }
    if (!/<meta name="robots" content="noindex" \/>/.test(text)) problems.push(name + " must keep <meta name=\"robots\" content=\"noindex\" /> until go-live");
  }
  const link = new RegExp('<a href="' + PAGE.replace(/\./g, "\\.") + '"([^>]*)>([\\s\\S]*?)</a>').exec(html);
  if (!link) problems.push(INDEX + " has no link to " + PAGE);
  else {
    if (!/\blang="en"/.test(link[1]) || /data-i18n/.test(link[1])) problems.push("the article title in " + INDEX + " must carry lang=\"en\" and no data-i18n (English-only exception)");
    const h1 = fragment && /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(fragment);
    if (!h1) problems.push("the article fragment has no <h1> to compare the index title with");
    else if (plainText(link[2]) !== plainText(h1[1])) problems.push("the title in " + INDEX + " ('" + plainText(link[2]) + "') differs from the article's <h1> ('" + plainText(h1[1]) + "')");
  }
  if (!html.includes('data-i18n="' + SUMMARY_KEY + '"')) problems.push(INDEX + " does not show the summary key " + SUMMARY_KEY);
  // The English in the HTML (no-JS fallback, meta and og text) must equal en.js and carry no digit.
  let en = null;
  try { en = loadEnglish(docsDir); } catch (error) { /* reported below */ }
  if (en) {
    for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      if (m[2] in en && m[3].trim() !== en[m[2]].trim()) problems.push(INDEX + ": the English text of '" + m[2] + "' differs from i18n/en.js");
    }
    const desc = /<meta name="description" content="([^"]*)"/.exec(html);
    if (!desc || desc[1] !== en.articles_description) problems.push(INDEX + ": the meta description differs from articles_description in i18n/en.js");
  }
  for (const m of html.matchAll(/<meta (?:name|property)="(description|og:title|og:description)" content="([^"]*)"/g)) {
    if (/\d/.test(m[2])) problems.push(INDEX + ": " + m[1] + " holds a digit");
  }
  for (const lang of LANGS) {
    let d = null;
    try { d = loadLanguage(docsDir, lang); } catch (error) { problems.push("cannot load i18n/" + lang + ".js"); continue; }
    if (!d || typeof d[SUMMARY_KEY] !== "string" || !d[SUMMARY_KEY].trim()) problems.push("i18n/" + lang + ".js has no " + SUMMARY_KEY);
    else if (/\d/.test(d[SUMMARY_KEY])) problems.push("the " + lang + " summary holds a digit: the index summary carries no number or rate");
  }
  for (const file of fs.readdirSync(docsDir).filter((f) => f.endsWith(".html")).sort()) {
    const nav = /<nav id="primary-nav"[\s\S]*?<\/nav>/.exec(fs.readFileSync(path.join(docsDir, file), "utf8"));
    if (!nav) { problems.push(file + ": no primary navigation (<nav id=\"primary-nav\">)"); continue; }
    if (!/data-i18n="open_source">Open-Source<\/a>\s*<a href="articles\.html" data-i18n="articles">Articles<\/a>/.test(nav[0])) problems.push(file + ": the Articles tab must follow Open-Source in the primary navigation");
  }
  return problems;
}

// Checks of the page around the fragment: form fields, keys, scripts, consent version.
function checkFrame(html, docsDir) {
  const problems = [];
  const loc = locateFragment(html);
  const frame = loc.error ? html : html.slice(0, loc.start) + html.slice(loc.end);
  const formMatch = /<form\b[^>]*\bid="report-request-form"[^>]*>([\s\S]*?)<\/form>/.exec(frame);
  if (!formMatch) problems.push("no <form id=\"report-request-form\"> outside the fragment");
  else {
    for (const field of FORM_FIELDS) {
      if (!new RegExp('<(input|textarea)\\b[^>]*\\bname="' + field + '"').test(formMatch[1])) problems.push("form field '" + field + "' is missing");
    }
    if (!/<input\b[^>]*name="consent"[^>]*type="checkbox"[^>]*\brequired\b|<input\b[^>]*type="checkbox"[^>]*name="consent"[^>]*\brequired\b/.test(formMatch[1])) problems.push("the consent field is not a required checkbox");
    problems.push(...checkAccessibility(formMatch[1]));
  }
  for (const id of SCRIPT_IDS) if (!frame.includes('id="' + id + '"')) problems.push("element id '" + id + "' is missing");
  const statusTag = /<[a-z]+\b[^>]*\bid="rf-status"[^>]*>/.exec(frame);
  if (statusTag && (!/role="status"/.test(statusTag[0]) || !/aria-live="polite"/.test(statusTag[0]) || /data-i18n/.test(statusTag[0]))) problems.push("rf-status needs role=\"status\", aria-live=\"polite\" and no data-i18n");
  for (const key of PAGE_KEYS) if (!frame.includes('data-i18n="' + key + '"')) problems.push("data-i18n key '" + key + "' is missing on the page");
  const scripts = [...frame.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const a = scripts.indexOf("script.js"), b = scripts.indexOf("report-form.js");
  if (a < 0 || b < 0 || b < a) problems.push("script.js must be loaded, then report-form.js");

  let en = null;
  try { en = loadEnglish(docsDir); } catch (error) { problems.push("cannot load i18n/en.js: " + error.message); }
  if (en) {
    const used = new Set([...frame.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
    for (const m of frame.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(";").forEach((pair) => used.add(pair.split(":")[1]));
    SCRIPT_KEYS.forEach((key) => used.add(key));
    for (const key of used) if (!(key in en)) problems.push("key '" + key + "' is not in i18n/en.js");
  }

  let script = "";
  try { script = fs.readFileSync(path.join(docsDir, "report-form.js"), "utf8"); } catch (error) { problems.push("cannot read report-form.js"); }
  const consent = /const CONSENT_VERSION = "([^"]*)";/.exec(script);
  if (!consent) problems.push("report-form.js has no CONSENT_VERSION constant");
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(consent[1])) problems.push("CONSENT_VERSION in report-form.js is unset ('" + consent[1] + "'): it must be the date the owner approved the consent text");
  return problems;
}

// The consent box is named by the consent text, and the trap field is out of the
// accessibility tree and the tab order while it stays in the form for the server's check.
function checkAccessibility(form) {
  const problems = [];
  const box = /<input\b[^>]*\bname="consent"[^>]*>/.exec(form);
  const labelledBy = box && /\baria-labelledby="([^"]+)"/.exec(box[0]);
  const idOf = box && /\bid="([^"]+)"/.exec(box[0]);
  const textTag = labelledBy && new RegExp('<[a-z]+\\b[^>]*\\bid="' + labelledBy[1] + '"[^>]*>').exec(form);
  if (!textTag || !/data-i18n="rf_consent"/.test(textTag[0])) problems.push("the consent checkbox must be aria-labelledby the element that holds data-i18n=\"rf_consent\"");
  if (!idOf || !new RegExp('<label\\b[^>]*\\bfor="' + idOf[1] + '"').test(form)) problems.push("the consent checkbox needs a <label for> holding the consent text");
  const trap = /<div\b[^>]*\bclass="rf-trap"[^>]*>([\s\S]*?)<\/div>/.exec(form);
  if (!trap) problems.push("the trap field must sit in a <div class=\"rf-trap\">");
  else {
    const open = /<div\b[^>]*>/.exec(trap[0])[0];
    if (!/\baria-hidden="true"/.test(open) || !/\binert\b/.test(open)) problems.push("the rf-trap wrapper needs aria-hidden=\"true\" and inert");
    const input = /<input\b[^>]*\bname="website"[^>]*>/.exec(trap[1]);
    if (!input) problems.push("the website field must be inside the rf-trap wrapper");
    else if (!/\btabindex="-1"/.test(input[0]) || !/\bautocomplete="off"/.test(input[0])) problems.push("the website field needs tabindex=\"-1\" and autocomplete=\"off\"");
  }
  return problems;
}

function checkPage(docsDir, expect) {
  const pagePath = path.join(docsDir, PAGE);
  let html;
  try { html = fs.readFileSync(pagePath, "utf8"); } catch (error) { return ["cannot read " + pagePath]; }
  const problems = [];
  const loc = locateFragment(html);
  if (loc.error) problems.push(loc.error);
  else {
    const actual = sha256(loc.fragment);
    if (actual !== loc.hash) problems.push("fragment sha256 " + actual + " differs from the marker's " + loc.hash);
    if (expect && loc.hash !== expect) problems.push("marker sha256 " + loc.hash + " differs from the expected (builder's) " + expect);
    problems.push(...checkFragment(loc.fragment));
  }
  problems.push(...checkFrame(html, docsDir));
  problems.push(...checkIndex(docsDir, loc.error ? null : loc.fragment));
  return problems;
}

/* ---------- Self-test (B2) ---------- */
function selfTest() {
  const docs = path.resolve(__dirname, "..", "docs");
  const fixtures = path.join(__dirname, "fixtures");
  const insert = require("./insert-article.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-article-"));
  let failures = 0;
  const results = [];

  // A temporary copy of the real page, its en.js and report-form.js with a set consent version.
  function freshCopy() {
    const dir = fs.mkdtempSync(path.join(tmp, "docs-"));
    fs.mkdirSync(path.join(dir, "i18n"));
    for (const f of fs.readdirSync(docs).filter((f) => f.endsWith(".html"))) fs.copyFileSync(path.join(docs, f), path.join(dir, f));
    for (const lang of LANGS) fs.copyFileSync(path.join(docs, "i18n", lang + ".js"), path.join(dir, "i18n", lang + ".js"));
    const script = fs.readFileSync(path.join(docs, "report-form.js"), "utf8").replace(/const CONSENT_VERSION = "[^"]*";/, 'const CONSENT_VERSION = "2026-11-17";');
    fs.writeFileSync(path.join(dir, "report-form.js"), script);
    return dir;
  }
  function edit(dir, fn) {
    const p = path.join(dir, PAGE);
    fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8")));
  }
  function expectCase(name, dir, wantPass, expect, mustMention) {
    const problems = checkPage(dir, expect);
    const passed = problems.length === 0;
    let ok = passed === wantPass;
    if (ok && mustMention && !problems.some((p) => p.includes(mustMention))) ok = false;
    if (!ok) failures++;
    results.push((ok ? "ok   " : "FAIL ") + name + (passed ? " (passes)" : " (refused: " + problems[0] + (problems.length > 1 ? "; +" + (problems.length - 1) : "") + ")"));
  }
  // The index shows the inserted article's title, as it must for the real article.
  function setIndexTitle(dir, fragment) {
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(fragment);
    const indexPath = path.join(dir, INDEX);
    if (h1) fs.writeFileSync(indexPath, fs.readFileSync(indexPath, "utf8").replace(/(<a href="ai-agents-misread-long-documents\.html" lang="en">)[^<]*/, (m, open) => open + plainText(h1[1])));
  }
  function inserted(fixture) {
    const dir = freshCopy();
    const file = path.join(fixtures, fixture);
    const out = insert.insertFragment(path.join(dir, PAGE), file, null);
    setIndexTitle(dir, fs.readFileSync(file, "utf8"));
    return { dir, hash: out.hash, file };
  }

  // 1. A final fragment with a table passes; the marker equals shasum of the file.
  const good = inserted("article-fragment-table.html");
  const fileHash = crypto.createHash("sha256").update(fs.readFileSync(good.file)).digest("hex");
  expectCase("final fragment with a table passes", good.dir, true);
  const markerOk = good.hash === fileHash && fs.readFileSync(path.join(good.dir, PAGE), "utf8").includes("sha256=" + fileHash + " -->");
  if (!markerOk) failures++;
  results.push((markerOk ? "ok   " : "FAIL ") + "marker hash equals the sha256 of the fragment file's bytes");
  expectCase("--expect with the builder's hash passes", good.dir, true, fileHash);
  expectCase("--expect with another hash is refused", good.dir, false, "f".repeat(64), "expected (builder's)");

  // 2. A second final fragment, without a table, passes.
  expectCase("final fragment without a table passes", inserted("article-fragment-plain.html").dir, true);

  // 3. Mutations of the inserted page.
  let c = inserted("article-fragment-table.html");
  edit(c.dir, (h) => h.replace("Long minutes", "Long minuteS"));
  expectCase("fragment edited by one byte is refused", c.dir, false, null, "differs from the marker");

  c = inserted("article-fragment-table.html");
  edit(c.dir, (h) => h.replace("<p>Every figure", '<p data-i18n="x">Every figure'));
  expectCase("data-i18n inside the fragment is refused (hash fixed up)", c.dir, false, null, "data-i18n");
  edit(c.dir, (h) => { const l = locateFragment(h); return h.replace(/sha256=[0-9a-f]{64}/, "sha256=" + sha256(l.fragment)); });
  expectCase("data-i18n inside the fragment is refused even with a matching hash", c.dir, false, null, "data-i18n");

  expectCase("fragment with the DRAFT mark is refused", inserted("article-fragment-draft.html").dir, false, null, "DRAFT");

  const planted = [
    ["an email address", "<p>Write to " + ["someone", "example.org"].join(String.fromCharCode(64)) + ".</p>", "email address"],
    ["a script element", "<p>x</p><script>alert(1)</script>", "script element"],
    ["an on...= attribute", '<p onclick="x()">x</p>', "event handler"],
    ["a data-mail link", '<p><a href="#" data-mail="">x</a></p>', "data-mail"],
    ["'30%'", "<p>about 30% of answers</p>", "'30%'"],
    ["'29.3'", "<p>a rate of 29.3 in a hundred</p>", "29.3"]
  ];
  for (const [label, snippet, mention] of planted) {
    const dir = freshCopy();
    const frag = fs.readFileSync(path.join(fixtures, "article-fragment-plain.html"), "utf8").replace("</article>", snippet + "\n</article>");
    const fragFile = path.join(dir, "planted.html");
    fs.writeFileSync(fragFile, frag);
    // insert-article.js refuses these itself; write the page directly to test check-article alone.
    edit(dir, (h) => { const l = locateFragment(h); return h.slice(0, l.start).replace(/sha256=[0-9a-f]{64}/, "sha256=" + sha256(frag)) + frag + h.slice(l.end); });
    expectCase("fragment with " + label + " is refused", dir, false, null, mention);
  }

  // A legitimate 30.2% and 130% pass the phrase rule.
  {
    const dir = freshCopy();
    const frag = fs.readFileSync(path.join(fixtures, "article-fragment-plain.html"), "utf8").replace("</article>", "<p>30.2% and 130% are fine.</p>\n</article>");
    edit(dir, (h) => { const l = locateFragment(h); return h.slice(0, l.start).replace(/sha256=[0-9a-f]{64}/, "sha256=" + sha256(frag)) + frag + h.slice(l.end); });
    setIndexTitle(dir, frag);
    expectCase("'30.2%' and '130%' pass", dir, true);
  }

  c = inserted("article-fragment-table.html");
  edit(c.dir, (h) => h.replace(/<textarea id="rf-comment" name="comment"/, '<textarea id="rf-comment" name="note"'));
  expectCase("missing form field 'comment' is refused", c.dir, false, null, "'comment'");

  c = inserted("article-fragment-table.html");
  edit(c.dir, (h) => h.replace('data-i18n="rf_consent"', 'data-i18n="rf_consent_x"'));
  expectCase("missing page key 'rf_consent' is refused", c.dir, false, null, "rf_consent");

  for (const [label, from, to, mention] of [
    ["trap wrapper without inert", 'class="rf-trap" aria-hidden="true" inert>', 'class="rf-trap" aria-hidden="true">', "inert"],
    ["trap wrapper without aria-hidden", 'class="rf-trap" aria-hidden="true" inert>', 'class="rf-trap" inert>', "aria-hidden"],
    ["website field without tabindex=-1", 'name="website" type="text" tabindex="-1"', 'name="website" type="text"', "tabindex"],
    ["consent box without aria-labelledby", ' aria-labelledby="rf-consent-text"', "", "aria-labelledby"],
    ["consent text without its id", '<span id="rf-consent-text" data-i18n="rf_consent">', '<span data-i18n="rf_consent">', "aria-labelledby"],
    ["consent label without for", '<label for="rf-consent">', "<label>", "label for"]
  ]) {
    c = inserted("article-fragment-table.html");
    let changed = false;
    edit(c.dir, (h) => { changed = h.includes(from); return h.replace(from, to); });
    if (!changed) { failures++; results.push("FAIL " + label + ": the page no longer holds the text the case edits"); continue; }
    expectCase(label + " is refused", c.dir, false, null, mention);
  }

  // The articles index and the Articles tab.
  function editFile(dir, file, fn) { const p = path.join(dir, file); fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8"))); }
  for (const [label, file, fn, mention] of [
    ["index without noindex", INDEX, (h) => h.replace('<meta name="robots" content="noindex" />', ""), "noindex"],
    ["article page without noindex", PAGE, (h) => h.replace('<meta name="robots" content="noindex" />', ""), "noindex"],
    ["index title that differs from the article's h1", INDEX, (h) => h.replace(/(<a href="ai-agents-misread-long-documents\.html" lang="en">)[^<]*/, "$1Another title"), "differs from the article's"],
    ["index title with data-i18n", INDEX, (h) => h.replace('long-documents.html" lang="en">', 'long-documents.html" lang="en" data-i18n="x">'), "English-only"],
    ["index without the summary key", INDEX, (h) => h.replace('data-i18n="art_misread_summary"', 'data-i18n="art_other"'), "summary key"],
    ["a summary with a digit (pl)", "i18n/pl.js", (h) => h.replace(/("art_misread_summary": ")/, "$1W 2026 "), "pl summary holds a digit"],
    ["a page without the Articles tab", "about.html", (h) => h.replace('<a href="articles.html" data-i18n="articles">Articles</a>', ""), "about.html: the Articles tab"],
    ["a page whose nav lost its id", "about.html", (h) => h.replace('<nav id="primary-nav"', '<nav id="main-nav"'), "about.html: no primary navigation"],
    ["index title without lang=en", INDEX, (h) => h.replace('long-documents.html" lang="en">', 'long-documents.html">'), "English-only"],
    ["a summary missing in one language (rm)", "i18n/rm.js", (h) => h.replace(/\n  "art_misread_summary": "[^"]*"/, '\n  "art_misread_other": "x"'), "rm.js has no art_misread_summary"],
    ["an index fallback that differs from en.js", INDEX, (h) => h.replace('data-i18n="art_misread_summary">Test results', 'data-i18n="art_misread_summary">Edited results'), "differs from i18n/en.js"],
    ["an index og:description with a digit", INDEX, (h) => h.replace('<meta property="og:description" content="Articles', '<meta property="og:description" content="29 articles'), "og:description holds a digit"],
    ["an index meta description that differs from en.js", INDEX, (h) => h.replace('<meta name="description" content="Articles from', '<meta name="description" content="Notes from'), "meta description differs"],
    ["consent box labelled by an element without rf_consent", PAGE, (h) => h.replace('<span id="rf-consent-text" data-i18n="rf_consent">', '<span id="rf-consent-text" data-i18n="rf_consent_x">').replace('</label>\n            <span class="field-error" id="rf-error-consent">', '<span data-i18n="rf_consent"></span></label>\n            <span class="field-error" id="rf-error-consent">'), "aria-labelledby the element that holds"],
    ["website field without autocomplete=off", PAGE, (h) => h.replace('tabindex="-1" autocomplete="off"', 'tabindex="-1"'), "autocomplete"],
    ["website field outside the rf-trap wrapper", PAGE, (h) => h.replace('<input id="rf-website" name="website" type="text" tabindex="-1" autocomplete="off" />\n          </div>', '</div>\n          <input id="rf-website" name="website" type="text" tabindex="-1" autocomplete="off" />'), "inside the rf-trap wrapper"]
  ]) {
    c = inserted("article-fragment-table.html");
    const before = fs.readFileSync(path.join(c.dir, file), "utf8");
    editFile(c.dir, file, fn);
    if (fs.readFileSync(path.join(c.dir, file), "utf8") === before) { failures++; results.push("FAIL " + label + ": the edit changed nothing"); continue; }
    expectCase(label + " is refused", c.dir, false, null, mention);
  }

  c = inserted("article-fragment-table.html");
  edit(c.dir, (h) => h.replace('<script src="report-form.js"></script>', ""));
  expectCase("page without report-form.js is refused", c.dir, false, null, "report-form.js");

  c = inserted("article-fragment-table.html");
  fs.writeFileSync(path.join(c.dir, "report-form.js"), fs.readFileSync(path.join(docs, "report-form.js"), "utf8").replace(/const CONSENT_VERSION = "[^"]*";/, 'const CONSENT_VERSION = "UNSET-test";'));
  expectCase("unset consent version is refused", c.dir, false, null, "CONSENT_VERSION");

  c = inserted("article-fragment-table.html");
  edit(c.dir, (h) => h.replace(END_MARK, END_MARK + "\n" + END_MARK));
  expectCase("two END markers are refused", c.dir, false, null, "ARTICLE:END");

  // insert-article.js refuses a fragment with a forbidden element and a wrong --expect.
  for (const [label, run] of [
    ["insert-article refuses a fragment with a script element", () => {
      const dir = freshCopy();
      const f = path.join(dir, "bad.html");
      fs.writeFileSync(f, fs.readFileSync(path.join(fixtures, "article-fragment-plain.html"), "utf8").replace("</article>", "<script></script></article>"));
      insert.insertFragment(path.join(dir, PAGE), f, null);
    }],
    ["insert-article refuses a fragment whose hash differs from --expect", () => {
      const dir = freshCopy();
      insert.insertFragment(path.join(dir, PAGE), path.join(fixtures, "article-fragment-plain.html"), "0".repeat(64));
    }]
  ]) {
    let threw = false;
    try { run(); } catch (error) { threw = true; }
    if (!threw) failures++;
    results.push((threw ? "ok   " : "FAIL ") + label);
  }

  // The committed page itself must be refused while it holds the placeholder or the unset consent.
  const committed = checkPage(docs);
  const refusedNow = committed.some((p) => p.includes("DRAFT"));
  if (!refusedNow) failures++;
  results.push((refusedNow ? "ok   " : "FAIL ") + "the committed page (placeholder fragment) is refused: " + committed.length + " problem(s)");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(results.join("\n"));
  console.log(failures ? "SELF-TEST FAIL " + failures : "SELF-TEST OK " + results.length + " cases");
  return failures ? 1 : 0;
}

function main(argv) {
  if (argv[0] === "--self-test") return selfTest();
  const docsDir = argv[0];
  const ei = argv.indexOf("--expect");
  const expect = ei >= 0 ? argv[ei + 1] : null;
  if (!docsDir || (ei >= 0 && !/^[0-9a-f]{64}$/.test(expect || ""))) {
    console.error("usage: node tools/check-article.js docs [--expect <sha256>] | --self-test");
    return 2;
  }
  const problems = checkPage(docsDir, expect);
  if (problems.length) {
    console.log("FAIL " + PAGE);
    problems.forEach((p) => console.log("  - " + p));
    return 1;
  }
  console.log("OK " + PAGE);
  return 0;
}

module.exports = { locateFragment, checkFragment, checkPage, checkIndex, sha256, PAGE, INDEX, END_MARK, OPEN_TAG };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
