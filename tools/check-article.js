// Checks the article pages (plan I9, I11; acceptance B2; managed documents plan J9, B1).
// An article page is any docs/*.html that holds an ARTICLE:BEGIN marker.
// Usage: node tools/check-article.js docs [--page NAME --expect <sha256>]
//        node tools/check-article.js docs --expect <sha256>     (when there is one article page)
//        node tools/check-article.js --self-test
// Exits 0 when every check passes, 1 when one fails, 2 on a usage error.
//
// The fragment is the text strictly between the line of
//   <!-- ARTICLE:BEGIN sha256=<hex> -->
// (after its newline) and the start of <!-- ARTICLE:END -->. Its sha256 must equal the
// marker's, and, for the page --expect is bound to, the hash that build_article.py --final printed.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PAGE = "ai-agents-misread-long-documents.html"; // the first article page; the self-test builds on it
const INDEX = "articles.html";
const SITEMAP = "sitemap.xml";
const SITE = "https://deepproof.ch/";
// The document id pattern of the collector and of docs/report-form.js (bizanso sites.mjs).
const DOCUMENT_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const LANGS = ["en", "de", "es", "fr", "it", "nl", "pl", "pt", "rm", "ro"];
const BEGIN_RE = /<!-- ARTICLE:BEGIN sha256=([0-9a-f]{64}) -->\n/g;
const END_MARK = "<!-- ARTICLE:END -->";
const OPEN_TAG = '<article lang="en" class="article-copy">';
const FORM_FIELDS = ["name", "email", "company", "comment", "website", "consent"];
const ARTICLE_KEYS = ["art_english_note", "test_results"];
const FORM_KEYS = ["rf_heading", "rf_intro", "rf_name", "rf_email", "rf_company", "rf_comment", "rf_consent", "rf_submit"];
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
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

// The article pages of a docs folder: every *.html that mentions ARTICLE:BEGIN, loosely, so that a
// page with a broken marker is still checked (and refused) instead of dropping out.
function articlePages(docsDir) {
  return fs.readdirSync(docsDir).filter((f) => f.endsWith(".html") && fs.readFileSync(path.join(docsDir, f), "utf8").includes("ARTICLE:BEGIN")).sort();
}

// The page outside the article fragment (the whole page when the markers are broken).
function outsideFragment(html) {
  const loc = locateFragment(html);
  return loc.error ? html : html.slice(0, loc.start) + html.slice(loc.end);
}

// The report form of a page: { tag, count, document } or null. document is the data-document value or null.
// check-documents.js reads pages through this function too, so the two tools cannot disagree.
function pageForm(html) {
  const frame = outsideFragment(html);
  const tags = [...frame.matchAll(/<form\b[^>]*\bid="report-request-form"[^>]*>/g)].map((m) => m[0]);
  if (!tags.length) return null;
  const attr = /\bdata-document="([^"]*)"/.exec(tags[0]);
  return { tag: tags[0], count: tags.length, document: attr ? attr[1] : null };
}

// The articles index (articles.html) and the Articles tab of every page. pages: [{ name, fragment }].
function checkIndex(docsDir, pages) {
  const problems = [];
  let html;
  try { html = fs.readFileSync(path.join(docsDir, INDEX), "utf8"); } catch (error) { return ["cannot read " + INDEX]; }
  // Since go-live (19 November 2026) the index and every article page are public: no robots meta that
  // holds noindex, and each page is listed in sitemap.xml. A new article page joins the sitemap in its own commit.
  const robotsNoindex = (text) => [...text.matchAll(/<meta\b[^>]*\bname=["']robots["'][^>]*>/gi)].some((m) => /noindex/i.test(m[0]));
  let sitemap = null;
  try { sitemap = fs.readFileSync(path.join(docsDir, SITEMAP), "utf8"); } catch (error) { problems.push("cannot read " + SITEMAP); }
  for (const name of [INDEX, ...pages.map((p) => p.name)]) {
    let text = name === INDEX ? html : null;
    if (text === null) { try { text = fs.readFileSync(path.join(docsDir, name), "utf8"); } catch (error) { continue; } }
    if (robotsNoindex(text)) problems.push(name + " carries a robots noindex meta: the articles are public since go-live");
    if (sitemap !== null && !sitemap.includes("<loc>" + SITE + name + "</loc>")) problems.push(name + " is not listed in " + SITEMAP + " as <loc>" + SITE + name + "</loc>");
  }
  const entries = [...html.matchAll(/<li class="article-entry">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  const summaryKeys = [];
  for (const { name, fragment } of pages) {
    // Exactly one entry per article page; its link, title and summary key are read from that entry alone.
    const own = entries.filter((entry) => new RegExp('<a href="' + escapeRe(name) + '"').test(entry));
    if (own.length === 0) { problems.push(INDEX + " has no link to " + name); continue; }
    if (own.length > 1) { problems.push(INDEX + " has " + own.length + " entries for " + name + ": exactly one is allowed"); continue; }
    const link = new RegExp('<a href="' + escapeRe(name) + '"([^>]*)>([\\s\\S]*?)</a>').exec(own[0]);
    if (!link) problems.push(INDEX + ": the link to " + name + " has no closing </a> inside its entry");
    else {
      if (!/\blang="en"/.test(link[1]) || /data-i18n/.test(link[1])) problems.push("the article title of " + name + " in " + INDEX + " must carry lang=\"en\" and no data-i18n (English-only exception)");
      const h1 = fragment && /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(fragment);
      if (!h1) problems.push(name + ": the article fragment has no <h1> to compare the index title with");
      else if (plainText(link[2]) !== plainText(h1[1])) problems.push("the title in " + INDEX + " ('" + plainText(link[2]) + "') differs from the article's <h1> ('" + plainText(h1[1]) + "') in " + name);
    }
    const summary = /<p\b[^>]*\bclass="article-summary"[^>]*>/.exec(own[0]);
    const key = summary && /\bdata-i18n="([^"]+)"/.exec(summary[0]);
    if (!key) problems.push(INDEX + ": the entry for " + name + " has no summary key (data-i18n on its <p class=\"article-summary\">)");
    else summaryKeys.push([name, key[1]]);
  }
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
    for (const [name, key] of summaryKeys) {
      if (!d || typeof d[key] !== "string" || !d[key].trim()) problems.push("i18n/" + lang + ".js has no " + key + " (the summary key of " + name + ")");
      else if (/\d/.test(d[key])) problems.push("the " + lang + " summary holds a digit: the index summary carries no number or rate");
    }
  }
  for (const file of fs.readdirSync(docsDir).filter((f) => f.endsWith(".html")).sort()) {
    const nav = /<nav id="primary-nav"[\s\S]*?<\/nav>/.exec(fs.readFileSync(path.join(docsDir, file), "utf8"));
    if (!nav) { problems.push(file + ": no primary navigation (<nav id=\"primary-nav\">)"); continue; }
    if (!/data-i18n="open_source">Open-Source<\/a>\s*<a href="articles\.html" data-i18n="articles">Articles<\/a>/.test(nav[0])) problems.push(file + ": the Articles tab must follow Open-Source in the primary navigation");
  }
  return problems;
}

// Checks of the page around the fragment: form fields, keys, scripts, consent version.
// A page with a form (id="report-request-form") gets the form rules, a data-document that matches the
// document id pattern, and report-form.js loaded after script.js. A page without one must not load report-form.js.
function checkFrame(html, docsDir) {
  const problems = [];
  const frame = outsideFragment(html);
  const form = pageForm(html);
  const scripts = [...frame.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const a = scripts.indexOf("script.js"), b = scripts.indexOf("report-form.js");
  let en = null;
  try { en = loadEnglish(docsDir); } catch (error) { problems.push("cannot load i18n/en.js: " + error.message); }
  const used = new Set([...frame.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
  for (const m of frame.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(";").forEach((pair) => used.add(pair.split(":")[1]));

  for (const key of ARTICLE_KEYS) if (!frame.includes('data-i18n="' + key + '"')) problems.push("data-i18n key '" + key + "' is missing on the page");
  if (!form) {
    if (b >= 0) problems.push("the page has no <form id=\"report-request-form\"> but loads report-form.js: an article without a form does not load the script");
    if (/\bid="rf-/.test(frame)) problems.push("the page has report form elements (id=\"rf-...\") but no <form id=\"report-request-form\">");
  } else {
    if (form.count !== 1) problems.push("the page has " + form.count + " report forms: one form per page");
    if (form.document === null) problems.push("the form has no data-document: it must name the document the page offers");
    else if (!DOCUMENT_ID.test(form.document)) problems.push("data-document '" + form.document + "' does not match the document id pattern " + DOCUMENT_ID);
    const formMatch = /<form\b[^>]*\bid="report-request-form"[^>]*>([\s\S]*?)<\/form>/.exec(frame);
    if (!formMatch) problems.push("the <form id=\"report-request-form\"> has no closing </form>");
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
    for (const key of FORM_KEYS) if (!frame.includes('data-i18n="' + key + '"')) problems.push("data-i18n key '" + key + "' is missing on the page");
    if (a < 0 || b < 0 || b < a) problems.push("script.js must be loaded, then report-form.js");
    SCRIPT_KEYS.forEach((key) => used.add(key));

    let script = "";
    try { script = fs.readFileSync(path.join(docsDir, "report-form.js"), "utf8"); } catch (error) { problems.push("cannot read report-form.js"); }
    const consent = /const CONSENT_VERSION = "([^"]*)";/.exec(script);
    if (!consent) problems.push("report-form.js has no CONSENT_VERSION constant");
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(consent[1])) problems.push("CONSENT_VERSION in report-form.js is unset ('" + consent[1] + "'): it must be the date the owner approved the consent text");
  }
  if (en) for (const key of used) if (!(key in en)) problems.push("key '" + key + "' is not in i18n/en.js");
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

// The checks of one article page: fragment, marker hash, frame. expect binds the marker to the builder's hash.
function checkArticlePage(docsDir, name, expect) {
  let html;
  try { html = fs.readFileSync(path.join(docsDir, name), "utf8"); } catch (error) { return { problems: ["cannot read " + path.join(docsDir, name)], fragment: null }; }
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
  return { problems, fragment: loc.error ? null : loc.fragment };
}

// Every article page and the index. { pages: [{ name, problems }], index: [problems], none: [problems], all: [every problem] }.
// opts.expect binds to opts.page, or to the one article page when there is only one.
function checkDocs(docsDir, opts = {}) {
  const names = articlePages(docsDir);
  const bound = opts.page || (names.length === 1 ? names[0] : null);
  const pages = [];
  const index = [];
  const none = [];
  if (!names.length) none.push("no article page found in " + docsDir + " (a page that holds <!-- ARTICLE:BEGIN sha256=<hex> -->)");
  if (opts.expect && !bound) index.push("--expect needs --page when there is more than one article page");
  for (const name of names) {
    const r = checkArticlePage(docsDir, name, name === bound ? opts.expect : null);
    pages.push({ name, problems: r.problems, fragment: r.fragment });
  }
  index.push(...checkIndex(docsDir, pages.map((p) => ({ name: p.name, fragment: p.fragment }))));
  return { pages, index, none, all: [].concat(none, ...pages.map((p) => p.problems), index) };
}

// Every problem of the folder, as a flat list (the self-test's view).
function checkPage(docsDir, expect, page) {
  return checkDocs(docsDir, { expect, page }).all;
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
    fs.copyFileSync(path.join(docs, SITEMAP), path.join(dir, SITEMAP));
    const script = fs.readFileSync(path.join(docs, "report-form.js"), "utf8").replace(/const CONSENT_VERSION = "[^"]*";/, 'const CONSENT_VERSION = "2026-11-17";');
    fs.writeFileSync(path.join(dir, "report-form.js"), script);
    return dir;
  }
  function edit(dir, fn) {
    const p = path.join(dir, PAGE);
    fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8")));
  }
  function expectCase(name, dir, wantPass, expect, mustMention, page) {
    const problems = checkPage(dir, expect, page);
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
    ["index with noindex", INDEX, (h) => h.replace('<meta name="viewport"', '<meta name="robots" content="noindex" />\n    <meta name="viewport"'), "articles.html carries a robots noindex"],
    ["article page with noindex", PAGE, (h) => h.replace('<meta name="viewport"', '<meta name="robots" content="noindex" />\n    <meta name="viewport"'), PAGE + " carries a robots noindex"],
    ["article page with noindex, nofollow in another attribute order", PAGE, (h) => h.replace('<meta name="viewport"', "<meta content='noindex, nofollow' name='robots'>\n    <meta name=\"viewport\""), PAGE + " carries a robots noindex"],
    ["index missing from the sitemap", SITEMAP, (h) => h.replace("  <url><loc>https://deepproof.ch/articles.html</loc>", "  <url><loc>https://deepproof.ch/articles-old.html</loc>"), "articles.html is not listed in sitemap.xml"],
    ["article page missing from the sitemap", SITEMAP, (h) => h.replace(/  <url><loc>https:\/\/deepproof\.ch\/ai-agents-misread-long-documents\.html<\/loc>[^\n]*\n/, ""), PAGE + " is not listed in sitemap.xml"],
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

  /* ---------- Several article pages (managed documents plan J9, B1) ---------- */
  const SECOND = "second-article.html";
  const SECOND_KEY = "art_second_summary";
  const SECOND_TEXT = "Notes on a second subject.";
  // Adds a second article page to a temporary copy: its own document, fragment, index entry and summary in all ten
  // languages. Nothing of this reaches docs/ or docs/i18n.
  function withSecond(dir, o = {}) {
    const { document = "second-report", withForm = true, withEntry = true } = o;
    const secondPath = path.join(dir, SECOND);
    fs.copyFileSync(path.join(dir, PAGE), secondPath);
    const out = insert.insertFragment(secondPath, path.join(fixtures, "article-fragment-plain.html"), null);
    let html = fs.readFileSync(secondPath, "utf8").replace('data-document="llm-document-failures"', 'data-document="' + document + '"');
    if (!withForm) {
      html = html.replace(/\s*<section id="report"[\s\S]*?<\/section>/, "").replace('<script src="report-form.js"></script>', "");
      if (html.includes("report-request-form") || html.includes("report-form.js")) throw new Error("the second page still holds the form");
    }
    fs.writeFileSync(secondPath, html);
    const sitemapPath = path.join(dir, SITEMAP);
    const sitemap = fs.readFileSync(sitemapPath, "utf8");
    if (!sitemap.includes("</urlset>")) throw new Error("the sitemap has no </urlset>");
    fs.writeFileSync(sitemapPath, sitemap.replace("</urlset>", "  <url><loc>" + SITE + SECOND + "</loc></url>\n</urlset>"));
    for (const lang of LANGS) {
      const file = path.join(dir, "i18n", lang + ".js");
      const text = fs.readFileSync(file, "utf8");
      const next = text.replace(/("art_misread_summary": "[^"]*")/, '$1,\n  "' + SECOND_KEY + '": "' + SECOND_TEXT + '"');
      if (next === text) throw new Error("cannot add the summary to " + lang + ".js");
      fs.writeFileSync(file, next);
    }
    if (withEntry) {
      const indexPath = path.join(dir, INDEX);
      const entry = '        <li class="article-entry">\n          <p class="article-meta"><span data-i18n="test_results">Test results</span> · <span data-i18n="art_in_english">In English</span></p>\n' +
        '          <h2><a href="' + SECOND + '" lang="en">Fixture article without a table</a></h2>\n          <p class="article-summary" data-i18n="' + SECOND_KEY + '">' + SECOND_TEXT + '</p>\n        </li>\n      </ul>';
      const index = fs.readFileSync(indexPath, "utf8");
      if (!index.includes("      </ul>")) throw new Error("the index has no list end");
      fs.writeFileSync(indexPath, index.replace("      </ul>", entry));
    }
    return out.hash;
  }
  function twoPages(o) {
    const c = inserted("article-fragment-table.html");
    const secondHash = withSecond(c.dir, o);
    return { dir: c.dir, firstHash: c.hash, secondHash };
  }
  // Applies a mutation to a file of a temporary copy; the case fails when it changed nothing.
  function mutate(dir, file, fn) {
    const p = path.join(dir, file);
    const before = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, fn(before));
    return fs.readFileSync(p, "utf8") !== before;
  }
  function mutationCase(label, dir, file, fn, mention, page) {
    if (!mutate(dir, file, fn)) { failures++; results.push("FAIL " + label + ": the edit changed nothing"); return; }
    expectCase(label + " is refused", dir, false, null, mention, page);
  }
  function runMain(argv) {
    const log = console.log, error = console.error;
    let out = "";
    console.log = (...a) => { out += a.join(" ") + "\n"; };
    console.error = (...a) => { out += a.join(" ") + "\n"; };
    try { return { code: main(argv), out }; } finally { console.log = log; console.error = error; }
  }
  function boolCase(label, ok, detail) {
    if (!ok) failures++;
    results.push((ok ? "ok   " : "FAIL ") + label + (ok ? "" : ": " + detail));
  }

  // Malformed inputs the checker must report with a message, never crash on.
  c = inserted("article-fragment-table.html");
  mutationCase("a form with no closing </form>", c.dir, PAGE, (h) => h.replace("</form>", ""), "no closing </form>");
  c = inserted("article-fragment-table.html");
  mutationCase("an index entry whose link has no closing </a>", c.dir, INDEX, (h) => h.replace("</a></h2>", "</h2>"), "no closing </a>");
  c = inserted("article-fragment-table.html");
  mutationCase("report-form.js loaded before script.js", c.dir, PAGE, (h) => h.replace('<script src="script.js"></script>\n    <script src="report-form.js"></script>', '<script src="report-form.js"></script>\n    <script src="script.js"></script>'), "script.js must be loaded, then report-form.js");
  c = inserted("article-fragment-table.html");
  mutationCase("a page with a form and no script.js", c.dir, PAGE, (h) => h.replace('<script src="script.js"></script>\n', ""), "script.js must be loaded, then report-form.js");

  // Form rules: the document of the page.
  c = inserted("article-fragment-table.html");
  mutationCase("a form without data-document", c.dir, PAGE, (h) => h.replace(' data-document="llm-document-failures"', ""), "no data-document");
  for (const [label, value] of [["'Bad Id'", "Bad Id"], ["an empty value", ""], ["a trailing hyphen", "a-"], ["65 characters", "a".repeat(65)], ["a path", "../x"]]) {
    c = inserted("article-fragment-table.html");
    mutationCase("data-document with " + label, c.dir, PAGE, (h) => h.replace('data-document="llm-document-failures"', 'data-document="' + value + '"'), "data-document '" + value + "' does not match");
  }
  c = inserted("article-fragment-table.html");
  expectCase("data-document of 63 characters passes", c.dir, mutate(c.dir, PAGE, (h) => h.replace('data-document="llm-document-failures"', 'data-document="' + "a".repeat(63) + '"')), null);

  // A second article page.
  let two = twoPages();
  expectCase("a second article page with its own document and index entry passes", two.dir, true);
  expectCase("the second page's document may equal the first's", (() => { const t = twoPages({ document: "llm-document-failures" }); return t.dir; })(), true);
  two = twoPages({ withEntry: false });
  expectCase("a second article page without an index entry is refused", two.dir, false, null, "articles.html has no link to " + SECOND);
  two = twoPages();
  mutationCase("a second index entry for the same page", two.dir, INDEX, (h) => h.replace("      </ul>", h.slice(h.indexOf('        <li class="article-entry">', h.indexOf(SECOND) - 300), h.lastIndexOf("      </ul>")) + "      </ul>"), "2 entries for " + SECOND);
  two = twoPages({ withForm: false });
  expectCase("an article page with no form and no report-form.js passes", two.dir, true);
  two = twoPages({ withForm: false });
  mutationCase("an article page with no form that still loads report-form.js", two.dir, SECOND, (h) => h.replace("</body>", '    <script src="report-form.js"></script>\n  </body>'), "loads report-form.js", undefined);
  two = twoPages({ withForm: false });
  mutationCase("an article page with the form's elements but no form", two.dir, SECOND, (h) => h.replace("</main>", '<p id="rf-status"></p></main>'), "no <form");
  two = twoPages();
  mutationCase("a form on the second page without data-document", two.dir, SECOND, (h) => h.replace(/ data-document="[^"]*"/, ""), "no data-document");
  two = twoPages();
  mutationCase("a form on the second page with a bad data-document", two.dir, SECOND, (h) => h.replace(/data-document="[^"]*"/, 'data-document="Bad Id"'), "data-document 'Bad Id'");
  two = twoPages();
  mutationCase("a second page without report-form.js although it has a form", two.dir, SECOND, (h) => h.replace('<script src="report-form.js"></script>', ""), "script.js must be loaded, then report-form.js");
  two = twoPages();
  mutationCase("a second page with noindex", two.dir, SECOND, (h) => h.replace('<meta name="viewport"', '<meta name="robots" content="noindex" />\n    <meta name="viewport"'), SECOND + " carries a robots noindex");
  two = twoPages();
  mutationCase("a second page missing from the sitemap", two.dir, SITEMAP, (h) => h.replace("  <url><loc>" + SITE + SECOND + "</loc></url>\n", ""), SECOND + " is not listed in sitemap.xml");
  two = twoPages();
  mutationCase("a second page whose index title differs from its h1", two.dir, INDEX, (h) => h.replace('lang="en">Fixture article without a table', 'lang="en">Another title'), "differs from the article's");
  two = twoPages();
  mutationCase("a second page whose index entry has no summary key", two.dir, INDEX, (h) => h.replace(' data-i18n="' + SECOND_KEY + '"', ""), "the entry for " + SECOND + " has no summary key");
  two = twoPages();
  mutationCase("a second page whose summary key is missing in one language (de)", two.dir, "i18n/de.js", (h) => h.replace('"' + SECOND_KEY + '"', '"art_second_other"'), "de.js has no " + SECOND_KEY);
  two = twoPages();
  mutationCase("a second page whose summary holds a digit (it)", two.dir, "i18n/it.js", (h) => h.replace(SECOND_TEXT, "Notes on 2 subjects."), "it summary holds a digit");
  two = twoPages();
  mutationCase("a second page whose index fallback differs from en.js", two.dir, INDEX, (h) => h.replace('data-i18n="' + SECOND_KEY + '">' + SECOND_TEXT, 'data-i18n="' + SECOND_KEY + '">Edited text'), "differs from i18n/en.js");
  two = twoPages();
  mutationCase("a second page whose fragment was edited by one byte", two.dir, SECOND, (h) => h.replace("Every figure here is invented.", "Every figure here is invented!"), "differs from the marker");

  // --expect binds one page's marker.
  two = twoPages();
  expectCase("--page --expect with the second page's builder hash passes", two.dir, true, two.secondHash, null, SECOND);
  expectCase("--page --expect with the first page's hash for the second page is refused", two.dir, false, two.firstHash, "expected (builder's)", SECOND);
  expectCase("--expect with two article pages and no --page is refused", two.dir, false, two.secondHash, "--expect needs --page");
  expectCase("--page --expect with another hash is refused", two.dir, false, "f".repeat(64), "expected (builder's)", SECOND);
  {
    const r = runMain([two.dir, "--page", SECOND, "--expect", two.secondHash]);
    boolCase("main: --page and --expect check all pages and exit 0", r.code === 0 && r.out.includes("OK " + SECOND) && r.out.includes("OK " + PAGE), "code " + r.code + " " + r.out);
    const w = runMain([two.dir, "--page", SECOND, "--expect", "e".repeat(64)]);
    boolCase("main: a wrong --expect exits 1 and names the page", w.code === 1 && w.out.includes("FAIL " + SECOND) && w.out.includes("OK " + PAGE), "code " + w.code + " " + w.out);
    for (const [label, argv] of [
      ["--expect with several pages and no --page", [two.dir, "--expect", two.secondHash]],
      ["--page without --expect", [two.dir, "--page", SECOND]],
      ["--page naming no article page", [two.dir, "--page", "about.html", "--expect", two.secondHash]],
      ["--expect that is not a sha256", [two.dir, "--expect", "abc"]],
      ["an unknown option", [two.dir, "--nope"]],
      ["no folder", []],
      ["a folder that does not exist", [path.join(tmp, "no-such-folder")]]
    ]) {
      const r2 = runMain(argv);
      boolCase("main: " + label + " is a usage error (exit 2)", r2.code === 2, "code " + r2.code);
    }
  }
  {
    // The existing form keeps working for one article page.
    const one = inserted("article-fragment-table.html");
    boolCase("main: --expect alone with one article page passes", runMain([one.dir, "--expect", one.hash]).code === 0, "failed");
    const bad = runMain([one.dir, "--expect", "e".repeat(64)]);
    boolCase("main: --expect alone with one article page and a wrong hash exits 1", bad.code === 1, "code " + bad.code);
    boolCase("main: one page prints exactly 'OK <page>'", runMain([one.dir]).out === "OK " + PAGE + "\n", JSON.stringify(runMain([one.dir]).out));
  }

  // No article page, and a page whose marker is broken.
  {
    const dir = freshCopy();
    fs.rmSync(path.join(dir, PAGE));
    expectCase("a folder with no article page is refused", dir, false, null, "no article page found");
    boolCase("main: a folder with no article page exits 1", runMain([dir]).code === 1, "not 1");
    c = inserted("article-fragment-table.html");
    mutationCase("a page with a broken ARTICLE:BEGIN marker is still checked", c.dir, PAGE, (h) => h.replace("<!-- ARTICLE:BEGIN sha256=", "<!--ARTICLE:BEGIN sha256="), "expected exactly one '<!-- ARTICLE:BEGIN");
    c = inserted("article-fragment-table.html");
    mutationCase("a page with two report forms", c.dir, PAGE, (h) => h.replace("</main>", '<form id="report-request-form" data-document="a"></form></main>'), "2 report forms");
  }

  // insert-article.js: --page is required when more than one article page exists.
  {
    const one = freshCopy();
    const two2 = twoPages();
    const none = freshCopy();
    fs.rmSync(path.join(none, PAGE));
    const r1 = insert.resolvePage(one, null), r2 = insert.resolvePage(two2.dir, null), r3 = insert.resolvePage(none, null), r4 = insert.resolvePage(two2.dir, "docs/x.html");
    boolCase("insert-article: one article page is the default", r1.page === path.join(one, PAGE), JSON.stringify(r1));
    boolCase("insert-article: several article pages need --page", !!r2.error && r2.error.includes("--page is required") && r2.error.includes(SECOND) && r2.error.includes(PAGE) && !r2.page, JSON.stringify(r2));
    boolCase("insert-article: no article page is an error", !!r3.error && !r3.page, JSON.stringify(r3));
    boolCase("insert-article: an explicit --page is used as given", r4.page === "docs/x.html" && !r4.error, JSON.stringify(r4));
  }

  // The committed page is either final (no problem at all) or still holds the DRAFT placeholder (then it must be
  // refused for it). Any other problem on the committed page fails the self-test. The draft state is recognised by
  // the checker's own message, not by the word DRAFT anywhere in a message, since messages can quote page text.
  const committed = checkPage(docs);
  const draftNow = committed.some((p) => p.startsWith("fragment holds the DRAFT mark"));
  const committedOk = committed.length === 0 || draftNow;
  if (!committedOk) failures++;
  const committedState = draftNow ? "a draft and is refused" : committed.length === 0 ? "final and is accepted" : "refused for another reason";
  results.push((committedOk ? "ok   " : "FAIL ") + "the committed page is " + committedState + ": " + committed.length + " problem(s)");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(results.join("\n"));
  console.log(failures ? "SELF-TEST FAIL " + failures : "SELF-TEST OK " + results.length + " cases");
  return failures ? 1 : 0;
}

const USAGE = "usage: node tools/check-article.js docs [--page NAME --expect <sha256>] | docs --expect <sha256> (one article page) | --self-test";

function main(argv) {
  if (argv[0] === "--self-test") return selfTest();
  let docsDir = null, expect = null, page = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--expect" || argv[i] === "--page") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) { console.error(USAGE); return 2; }
      if (argv[i - 1] === "--expect") expect = value; else page = value;
    } else if (argv[i].startsWith("--") || docsDir !== null) { console.error(USAGE); return 2; }
    else docsDir = argv[i];
  }
  if (!docsDir || (expect !== null && !/^[0-9a-f]{64}$/.test(expect)) || (page !== null && expect === null)) { console.error(USAGE); return 2; }
  let names;
  try { names = articlePages(docsDir); } catch (error) { console.error("cannot read " + docsDir + ": " + error.message); return 2; }
  if (page !== null && !names.includes(page)) { console.error(page + " is not an article page of " + docsDir + (names.length ? " (article pages: " + names.join(", ") + ")" : "")); return 2; }
  if (expect !== null && page === null && names.length > 1) { console.error("--expect needs --page when there is more than one article page (" + names.join(", ") + ")"); return 2; }
  const result = checkDocs(docsDir, { expect, page });
  let failed = false;
  if (result.none.length) { failed = true; console.log("FAIL " + docsDir); result.none.forEach((p) => console.log("  - " + p)); }
  for (const p of result.pages) {
    if (p.problems.length) { failed = true; console.log("FAIL " + p.name); p.problems.forEach((x) => console.log("  - " + x)); }
    else console.log("OK " + p.name);
  }
  if (result.index.length) { failed = true; console.log("FAIL " + INDEX); result.index.forEach((x) => console.log("  - " + x)); }
  return failed ? 1 : 0;
}

module.exports = { locateFragment, checkFragment, checkPage, checkDocs, checkIndex, articlePages, pageForm, outsideFragment, sha256, main, DOCUMENT_ID, PAGE, INDEX, END_MARK, OPEN_TAG };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
