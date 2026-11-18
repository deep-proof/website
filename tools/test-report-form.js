// Runs docs/report-form.js in a vm context with a fake document and a fake fetch
// (plan I10; acceptance B3). No request leaves this process.
// Usage: node tools/test-report-form.js     Exits 0 when every case passes.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DOCS = path.resolve(__dirname, "..", "docs");
const SOURCE = fs.readFileSync(path.join(DOCS, "report-form.js"), "utf8");
const SCRIPT_JS = fs.readFileSync(path.join(DOCS, "script.js"), "utf8");
const TEST_CONSENT = "2026-11-17";
const COLLECTOR = "https://bizanso.com/base-agent-additional-server/bizanso/8787/visitor-data/v1/submissions";

function loadI18n() {
  const window = {};
  for (const lang of ["en", "de", "es", "fr", "it", "nl", "pl", "pt", "rm", "ro"]) {
    new Function("window", fs.readFileSync(path.join(DOCS, "i18n", lang + ".js"), "utf8"))(window);
  }
  return window.DP_I18N;
}
const I18N = loadI18n();

/* ---------- A small fake DOM: only what report-form.js touches ---------- */
class FakeElement {
  constructor(id, extra) {
    this.id = id;
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.checked = false;
    this.href = "";
    this.attrs = {};
    this.listeners = {};
    Object.assign(this, extra || {});
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  async dispatch(type, event) {
    const results = (this.listeners[type] || []).map((fn) => fn(event || { type, preventDefault() {} }));
    await Promise.all(results);
  }
}

function makePage(options = {}) {
  const ids = ["rf-submit", "rf-status", "rf-result", "rf-success", "rf-link", "rf-expires", "rf-no-email", "rf-copy",
    "rf-error-name", "rf-error-email", "rf-error-company", "rf-error-comment", "rf-error-consent"];
  const els = {};
  ids.forEach((id) => (els[id] = new FakeElement(id)));
  els["rf-submit"].disabled = true;
  els["rf-result"].hidden = true;
  const fields = {};
  ["name", "email", "company", "comment", "website", "consent"].forEach((n) => (fields[n] = new FakeElement("rf-" + n, { name: n })));
  // The page's document: options.document (default the real article's); undefined means no data-document.
  const documentId = "document" in options ? options.document : "llm-document-failures";
  els["report-request-form"] = new FakeElement("report-request-form", { elements: fields, dataset: documentId === undefined ? {} : { document: documentId } });
  const docListeners = {};
  // Enough of a document for the real script.js to load and run applyLanguage().
  const document = {
    documentElement: { lang: "lang" in options ? options.lang : "en", dataset: { theme: "light" } },
    getElementById: (id) => els[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => (docListeners[type] = docListeners[type] || []).push(fn),
    dispatchEvent: (event) => { (docListeners[event.type] || []).forEach((fn) => fn(event)); return true; }
  };
  const calls = [];
  const tracked = [];
  const clipboard = [];
  const context = {
    document,
    window: { DP_I18N: JSON.parse(JSON.stringify(I18N)), matchMedia: () => ({ matches: false }) },
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    navigator: { clipboard: { writeText: async (text) => { if (options.clipboardFails) throw new Error("denied"); clipboard.push(text); } } },
    console,
    URL,
    Intl,
    Date,
    Number,
    Object,
    JSON,
    String,
    Promise,
    AbortSignal: { timeout: (ms) => ({ timeoutMs: ms }) },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (options.fetch) return options.fetch(url, init);
      throw new Error("no fetch configured");
    }
  };
  if (options.umami) context.window.umami = { track: (name, data) => tracked.push([name, data]) };
  vm.createContext(context);
  // The real script.js runs first, as on the page: it defines t() and currentLang as lexical
  // globals and dispatches "dp:language" from applyLanguage(). options.noScript leaves it out,
  // as on another website that copied report-form.js only.
  if (!options.noScript) vm.runInContext(SCRIPT_JS, context, { filename: "script.js" });
  const version = "consent" in options ? options.consent : TEST_CONSENT;
  const source = SOURCE.replace(/const CONSENT_VERSION = "[^"]*";/, 'const CONSENT_VERSION = "' + version + '";');
  vm.runInContext(source, context, { filename: "report-form.js" });
  const page = {
    els, fields, calls, tracked, clipboard, context,
    fill(values) { Object.entries(values).forEach(([k, v]) => { if (k === "consent") fields.consent.checked = v; else fields[k].value = v; }); },
    async submit() {
      let prevented = false;
      await els["report-request-form"].dispatch("submit", { type: "submit", preventDefault() { prevented = true; } });
      return prevented;
    },
    setLang(lang) { vm.runInContext("applyLanguage(" + JSON.stringify(lang) + ");", context); },
    status() { return els["rf-status"].textContent; }
  };
  return page;
}

const VALID = { name: "Ada Fixture", email: "ada" + String.fromCharCode(64) + "example.invalid", company: "Fixture AG", comment: "", consent: true };
const respond = (status, body) => async () => ({ status, json: async () => { if (body === undefined) throw new Error("no body"); return body; } });
const en = I18N.en, de = I18N.de;

/* ---------- Cases ---------- */
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
function assert(cond, message) { if (!cond) throw new Error(message); }
function eq(a, b, message) { if (a !== b) throw new Error(message + ": expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)); }

test("idle: form shown, result hidden, empty status, button enabled by the script", async () => {
  const p = makePage();
  eq(p.status(), "", "status");
  eq(p.els["report-request-form"].hidden, false, "form hidden");
  eq(p.els["rf-result"].hidden, true, "result hidden");
  eq(p.els["rf-submit"].disabled, false, "button disabled");
  eq(p.els["report-request-form"].getAttribute("novalidate"), "", "novalidate set");
});

test("invalid (client): empty form marks name, email, company, consent and sends nothing", async () => {
  const p = makePage({ fetch: respond(201, {}) });
  const prevented = await p.submit();
  assert(prevented, "submit default not prevented");
  eq(p.calls.length, 0, "fetch calls");
  eq(p.status(), en.js_rf_invalid, "status");
  eq(p.els["rf-error-name"].textContent, en.js_rf_field_required, "name message");
  eq(p.els["rf-error-email"].textContent, en.js_rf_field_required, "email message");
  eq(p.els["rf-error-company"].textContent, en.js_rf_field_required, "company message");
  eq(p.els["rf-error-consent"].textContent, en.js_rf_consent_required, "consent message");
  eq(p.els["rf-error-comment"].textContent, "", "comment message");
  eq(p.fields.name.getAttribute("aria-invalid"), "true", "aria-invalid");
  eq(p.fields.comment.getAttribute("aria-invalid"), null, "comment aria-invalid");
});

test("invalid (client): short name, bad address, long company and comment", async () => {
  const p = makePage({ fetch: respond(201, {}) });
  p.fill({ ...VALID, name: " A ", email: "not-an-address", company: "x".repeat(161), comment: "y".repeat(1001) });
  await p.submit();
  eq(p.calls.length, 0, "fetch calls");
  eq(p.els["rf-error-name"].textContent, en.js_rf_field_required, "too_short");
  eq(p.els["rf-error-email"].textContent, en.js_rf_field_email, "invalid email");
  eq(p.els["rf-error-company"].textContent, en.js_rf_field_long, "too_long");
  eq(p.els["rf-error-comment"].textContent, en.js_rf_field_long, "comment too_long");
});

test("sending: request shape, credentials omit, only content-type, button disabled while pending", async () => {
  let release;
  const pending = new Promise((r) => (release = r));
  const p = makePage({ lang: "de", fetch: async () => { await pending; return { status: 201, json: async () => ({ status: "created", downloadUrl: "https://bizanso.com/visitor-data/r/abc.def", expiresAt: "2026-11-24T10:00:00.000Z" }) }; } });
  p.fill({ ...VALID, name: "  Ada Fixture  ", comment: "  a comment  ", website: "" });
  const done = p.submit();
  await new Promise((r) => setImmediate(r));
  eq(p.status(), de.js_rf_sending, "sending status in German");
  eq(p.els["rf-submit"].disabled, true, "button disabled while sending");
  eq(p.calls.length, 1, "fetch calls");
  const { url, init } = p.calls[0];
  eq(url, COLLECTOR, "collector url");
  eq(init.method, "POST", "method");
  eq(init.mode, "cors", "mode");
  eq(init.credentials, "omit", "credentials");
  eq(JSON.stringify(Object.keys(init.headers)), JSON.stringify(["content-type"]), "headers");
  eq(init.headers["content-type"], "application/json", "content-type");
  eq(init.signal && init.signal.timeoutMs, 20000, "timeout signal");
  const body = JSON.parse(init.body);
  eq(JSON.stringify(Object.keys(body).sort()), JSON.stringify(["comment", "company", "consent", "consentVersion", "document", "email", "form", "lang", "name", "site", "website"]), "body keys");
  eq(body.site, "deepproof", "site");
  eq(body.form, "report-request", "form");
  eq(body.document, "llm-document-failures", "document");
  eq(body.name, "Ada Fixture", "trimmed name");
  eq(body.comment, "a comment", "trimmed comment");
  eq(body.consent, true, "consent");
  eq(body.consentVersion, TEST_CONSENT, "consent version");
  eq(body.lang, "de", "lang");
  eq(body.website, "", "honeypot");
  release();
  await done;
  eq(p.els["report-request-form"].hidden, true, "form hidden after success");
});

test("sending: a filled honeypot is sent as is, and fields are NFC-normalised", async () => {
  const p = makePage({ fetch: respond(201, { downloadUrl: "https://bizanso.com/visitor-data/r/x.y", expiresAt: "2026-11-24T10:00:00Z" }) });
  p.fill({ ...VALID, name: "Zoe\u0301 Fixture", website: "http://spam.example" });
  await p.submit();
  const body = JSON.parse(p.calls[0].init.body);
  eq(body.website, "http://spam.example", "honeypot value");
  eq(body.name, "Zo\u00e9 Fixture", "NFC name");
});

test("sending: an empty comment is left out of the body", async () => {
  const p = makePage({ fetch: respond(201, { status: "created", downloadUrl: "https://bizanso.com/visitor-data/r/x.y", expiresAt: "2026-11-24T10:00:00Z" }) });
  p.fill(VALID);
  await p.submit();
  assert(!("comment" in JSON.parse(p.calls[0].init.body)), "comment key present");
});

test("success: link, expiry with the 20-download limit, no-email sentence, umami event without data", async () => {
  const p = makePage({ umami: true, fetch: respond(201, { status: "created", downloadUrl: "https://bizanso.com/visitor-data/r/abc.def", expiresAt: "2026-11-24T10:00:00.000Z" }) });
  p.fill(VALID);
  await p.submit();
  eq(p.els["report-request-form"].hidden, true, "form hidden");
  eq(p.els["rf-result"].hidden, false, "result shown");
  eq(p.els["rf-link"].href, "https://bizanso.com/visitor-data/r/abc.def", "href");
  eq(p.els["rf-link"].textContent, "https://bizanso.com/visitor-data/r/abc.def", "link text");
  eq(p.els["rf-success"].textContent, en.js_rf_success, "success text");
  assert(p.els["rf-expires"].textContent.includes("2026") && !p.els["rf-expires"].textContent.includes("{date}"), "expiry date filled: " + p.els["rf-expires"].textContent);
  assert(p.els["rf-expires"].textContent.includes("20"), "20-download limit stated");
  eq(p.els["rf-no-email"].textContent, en.js_rf_no_email, "no-email text");
  eq(p.els["rf-copy"].textContent, en.js_rf_copy, "copy button");
  eq(p.status(), "", "status");
  eq(JSON.stringify(p.tracked), JSON.stringify([["report-requested", undefined]]), "umami");
  await p.submit();
  eq(p.calls.length, 1, "a second submit after success sends nothing");
});

test("success: copy button copies the link and redraws; a refused clipboard says so", async () => {
  const p = makePage({ fetch: respond(201, { downloadUrl: "https://bizanso.com/visitor-data/r/abc.def", expiresAt: "2026-11-24T10:00:00Z" }) });
  p.fill(VALID);
  await p.submit();
  await p.els["rf-copy"].dispatch("click");
  eq(JSON.stringify(p.clipboard), JSON.stringify(["https://bizanso.com/visitor-data/r/abc.def"]), "clipboard");
  eq(p.els["rf-copy"].textContent, en.js_rf_copied, "copied text");
  const q = makePage({ clipboardFails: true, fetch: respond(201, { downloadUrl: "https://bizanso.com/visitor-data/r/abc.def", expiresAt: "2026-11-24T10:00:00Z" }) });
  q.fill(VALID);
  await q.submit();
  await q.els["rf-copy"].dispatch("click");
  eq(q.els["rf-copy"].textContent, en.js_copy_failed, "copy failed text");
});

test("success without umami on the page does not fail", async () => {
  const p = makePage({ fetch: respond(201, { downloadUrl: "https://bizanso.com/visitor-data/r/abc.def", expiresAt: "2026-11-24T10:00:00Z" }) });
  p.fill(VALID);
  await p.submit();
  eq(p.els["rf-result"].hidden, false, "result shown");
});

for (const [label, url] of [["javascript:", "javascript:alert(1)"], ["http:", "http://bizanso.com/visitor-data/r/a.b"], ["another host", "https://bizanso.com.evil.example/r/a.b"], ["missing", undefined]]) {
  test("success with a " + label + " link is shown as unavailable, never as a link", async () => {
    const p = makePage({ fetch: respond(201, { downloadUrl: url, expiresAt: "2026-11-24T10:00:00Z" }) });
    p.fill(VALID);
    await p.submit();
    eq(p.status(), en.js_rf_unavailable, "status");
    eq(p.els["rf-link"].href, "", "href");
    eq(p.els["rf-result"].hidden, true, "result hidden");
  });
}

test("invalid (422): each server code maps to its field message", async () => {
  const p = makePage({ fetch: respond(422, { error: "invalid_request", fields: { name: "too_short", email: "invalid", company: "too_long", comment: "invalid", consent: "required" } }) });
  p.fill(VALID);
  await p.submit();
  eq(p.status(), en.js_rf_invalid, "status");
  eq(p.els["rf-error-name"].textContent, en.js_rf_field_required, "too_short");
  eq(p.els["rf-error-email"].textContent, en.js_rf_field_email, "invalid email");
  eq(p.els["rf-error-company"].textContent, en.js_rf_field_long, "too_long");
  eq(p.els["rf-error-comment"].textContent, en.js_rf_invalid, "invalid other field");
  eq(p.els["rf-error-consent"].textContent, en.js_rf_consent_required, "consent");
  eq(p.els["rf-submit"].disabled, false, "button enabled again");
  const q = makePage({ fetch: respond(422, { error: "invalid_request", fields: { name: "required" } }) });
  q.fill(VALID);
  await q.submit();
  eq(q.els["rf-error-name"].textContent, en.js_rf_field_required, "required");
});

test("422 naming only a field the reader cannot change (consentVersion) is unavailable", async () => {
  const p = makePage({ fetch: respond(422, { error: "invalid_request", fields: { consentVersion: "invalid" } }) });
  p.fill(VALID);
  await p.submit();
  eq(p.status(), en.js_rf_unavailable, "status");
});

test("limited (429): minutes from retryAfterSeconds, rounded up", async () => {
  const p = makePage({ fetch: respond(429, { error: "rate_limited", retryAfterSeconds: 1500 }) });
  p.fill(VALID);
  await p.submit();
  eq(p.status(), en.js_rf_rate_limited.replace("{minutes}", "25"), "status");
  eq(p.els["rf-submit"].disabled, false, "button enabled");
  const q = makePage({ fetch: respond(429, { error: "rate_limited", retryAfterSeconds: 61 }) });
  q.fill(VALID);
  await q.submit();
  eq(q.status(), en.js_rf_rate_limited.replace("{minutes}", "2"), "61 s gives 2 minutes");
});

for (const [label, fetchImpl] of [
  ["503 unavailable", respond(503, { error: "unavailable", reason: "no_report" })],
  ["500 with no JSON", respond(500)],
  ["404", respond(404, { error: "unknown_form" })],
  ["403 origin_not_allowed", respond(403, { error: "origin_not_allowed" })],
  ["201 with no JSON body", respond(201)],
  ["a rejected fetch (network, timeout, CORS refusal)", async () => { throw new TypeError("Failed to fetch"); }]
]) {
  test("unavailable: " + label + " gives js_rf_unavailable and enables the button", async () => {
    const p = makePage({ fetch: fetchImpl });
    p.fill(VALID);
    await p.submit();
    eq(p.status(), en.js_rf_unavailable, "status");
    eq(p.els["rf-submit"].disabled, false, "button enabled");
    eq(p.els["report-request-form"].hidden, false, "form still shown");
  });
}

test("shipped consent version is the UNSET marker or a YYYY-MM-DD date", async () => {
  const m = /const CONSENT_VERSION = "([^"]*)";/.exec(SOURCE);
  assert(m && (m[1] === "UNSET-awaiting-owner-approval" || /^\d{4}-\d{2}-\d{2}$/.test(m[1])), "CONSENT_VERSION is " + (m && m[1]));
});

test("unset consent version: nothing is sent and the state is unavailable", async () => {
  const p = makePage({ consent: "UNSET-test", fetch: respond(201, {}) });
  p.fill(VALID);
  await p.submit();
  eq(p.calls.length, 0, "fetch calls");
  eq(p.status(), en.js_rf_unavailable, "status");
});

test("language change redraws the status, field messages and success texts", async () => {
  const p = makePage({ fetch: respond(429, { retryAfterSeconds: 120 }) });
  p.fill(VALID);
  await p.submit();
  eq(p.status(), en.js_rf_rate_limited.replace("{minutes}", "2"), "English status");
  p.setLang("de");
  eq(p.status(), de.js_rf_rate_limited.replace("{minutes}", "2"), "German status after dp:language");
  assert(de.js_rf_rate_limited !== en.js_rf_rate_limited, "German differs from English");

  const q = makePage();
  await q.submit();
  q.setLang("ro");
  eq(q.els["rf-error-email"].textContent, I18N.ro.js_rf_field_required, "Romanian field message");
  eq(q.status(), I18N.ro.js_rf_invalid, "Romanian status");

  const r = makePage({ fetch: respond(201, { downloadUrl: "https://bizanso.com/visitor-data/r/abc.def", expiresAt: "2026-11-24T10:00:00Z" }) });
  r.fill(VALID);
  await r.submit();
  r.setLang("fr");
  eq(r.els["rf-success"].textContent, I18N.fr.js_rf_success, "French success");
  eq(r.els["rf-no-email"].textContent, I18N.fr.js_rf_no_email, "French no-email");
  assert(r.els["rf-expires"].textContent.startsWith(I18N.fr.js_rf_expires.split("{date}")[0]), "French expiry");
});

/* ---------- The document of the page (plan J8) ---------- */
const OK_BODY = { status: "created", downloadUrl: "https://bizanso.com/visitor-data/r/abc.def", expiresAt: "2026-11-24T10:00:00Z" };

test("document: the data-document of the form is sent, and another page's value is sent as is", async () => {
  const p = makePage({ document: "second-report-2", fetch: respond(201, OK_BODY) });
  p.fill(VALID);
  await p.submit();
  eq(p.calls.length, 1, "fetch calls");
  eq(JSON.parse(p.calls[0].init.body).document, "second-report-2", "document");
});

for (const [label, value] of [
  ["missing", undefined], ["empty", ""], ["upper case", "Bad Id"], ["a space", "a b"], ["a slash", "a/b"], ["a dot dot", "../x"],
  ["a leading hyphen", "-a"], ["a trailing hyphen", "a-"], ["an underscore", "a_b"], ["65 characters", "a".repeat(65)], ["padded with a space", " llm-document-failures"]
]) {
  test("document: a data-document that is " + label + " sends nothing and shows unavailable, even with valid fields", async () => {
    const p = makePage({ document: value, fetch: respond(201, OK_BODY) });
    eq(p.status(), en.js_rf_unavailable, "status at load");
    p.fill(VALID);
    await p.submit();
    eq(p.calls.length, 0, "fetch calls");
    eq(p.status(), en.js_rf_unavailable, "status after submit");
    eq(p.els["report-request-form"].hidden, false, "form hidden");
    eq(p.els["rf-result"].hidden, true, "result shown");
  });
}

test("document: 63 and 1 characters are valid ids", async () => {
  for (const id of ["a".repeat(63), "a", "0-9"]) {
    const p = makePage({ document: id, fetch: respond(201, OK_BODY) });
    p.fill(VALID);
    await p.submit();
    eq(p.calls.length, 1, "fetch calls for " + id);
  }
});

test("document: a 404 unknown_document is shown as unavailable", async () => {
  const p = makePage({ fetch: respond(404, { error: "unknown_document" }) });
  p.fill(VALID);
  await p.submit();
  eq(p.status(), en.js_rf_unavailable, "status");
  eq(p.els["rf-submit"].disabled, false, "button enabled");
});

test("document: the script's id pattern is the contract's", async () => {
  const m = /const DOCUMENT_ID = (\/[^\n]+\/);/.exec(SOURCE);
  assert(m, "DOCUMENT_ID constant not found");
  eq(m[1], "/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/", "pattern");
});

/* ---------- No t() and no currentLang: another website (plan J8) ---------- */
test("standalone: with no script.js the form sends, in the page's language", async () => {
  const p = makePage({ noScript: true, lang: "de", fetch: respond(201, OK_BODY) });
  eq(p.context.t, undefined, "t is defined");
  eq(p.status(), "", "status at load");
  p.fill(VALID);
  await p.submit();
  eq(p.calls.length, 1, "fetch calls");
  const body = JSON.parse(p.calls[0].init.body);
  eq(body.lang, "de", "lang");
  eq(body.document, "llm-document-failures", "document");
  eq(p.els["rf-result"].hidden, false, "result shown");
  eq(p.els["rf-success"].textContent, en.js_rf_success, "built-in English success text");
  assert(p.els["rf-expires"].textContent.includes("2026") && !p.els["rf-expires"].textContent.includes("{date}"), "expiry date: " + p.els["rf-expires"].textContent);
  eq(p.els["rf-copy"].textContent, en.js_rf_copy, "copy button");
  await p.els["rf-copy"].dispatch("click");
  eq(p.els["rf-copy"].textContent, en.js_rf_copied, "copied");
});

test("standalone: client validation, 422, 429 and failure texts come from the built-in English", async () => {
  const p = makePage({ noScript: true });
  await p.submit();
  eq(p.status(), en.js_rf_invalid, "status");
  eq(p.els["rf-error-name"].textContent, en.js_rf_field_required, "name message");
  eq(p.els["rf-error-email"].textContent, en.js_rf_field_required, "email message");
  eq(p.els["rf-error-consent"].textContent, en.js_rf_consent_required, "consent message");
  const q = makePage({ noScript: true, fetch: respond(429, { retryAfterSeconds: 1500 }) });
  q.fill(VALID);
  await q.submit();
  eq(q.status(), en.js_rf_rate_limited.replace("{minutes}", "25"), "429");
  const r = makePage({ noScript: true, fetch: respond(503, {}) });
  r.fill(VALID);
  await r.submit();
  eq(r.status(), en.js_rf_unavailable, "503");
  const u = makePage({ noScript: true, document: undefined });
  eq(u.status(), en.js_rf_unavailable, "no document at load");
  let release;
  const pending = new Promise((x) => (release = x));
  const s = makePage({ noScript: true, fetch: async () => { await pending; return { status: 201, json: async () => OK_BODY }; } });
  s.fill(VALID);
  const done = s.submit();
  await new Promise((x) => setImmediate(x));
  eq(s.status(), en.js_rf_sending, "sending");
  release();
  await done;
});

test("standalone: lang is sent only for one of the ten codes; a region tag gives its language", async () => {
  const sent = async (options) => {
    const p = makePage({ noScript: true, fetch: respond(201, OK_BODY), ...options });
    p.fill(VALID);
    await p.submit();
    return JSON.parse(p.calls[0].init.body);
  };
  eq((await sent({ lang: "ro" })).lang, "ro", "ro");
  eq((await sent({ lang: "de-CH" })).lang, "de", "de-CH");
  eq((await sent({ lang: "EN-us" })).lang, "en", "EN-us");
  for (const lang of ["", "xx", "klingon", "english"]) assert(!("lang" in (await sent({ lang }))), "lang '" + lang + "' was sent");
});

test("language: the language is read when the form is sent, not once at load", async () => {
  const p = makePage({ fetch: respond(201, OK_BODY) });
  p.setLang("fr");
  p.fill(VALID);
  await p.submit();
  eq(JSON.parse(p.calls[0].init.body).lang, "fr", "lang after a language change");
});

test("fallback texts: the built-in English equals i18n/en.js for every key the script uses", async () => {
  const block = /const FALLBACK_TEXTS = (\{[\s\S]*?\n  \});/.exec(SOURCE);
  assert(block, "FALLBACK_TEXTS not found");
  const fallback = new Function("return " + block[1])();
  const used = [...new Set([...SOURCE.matchAll(/\btext\("([a-z_]+)"\)/g)].map((m) => m[1]))].sort();
  assert(used.length >= 14, "keys used: " + used.length);
  eq(JSON.stringify(Object.keys(fallback).sort()), JSON.stringify(used), "keys of the fallback and the keys the script asks for");
  for (const key of used) eq(fallback[key], en[key], "fallback text of " + key);
});

test("every js_rf key is present in all ten languages", async () => {
  const keys = [...new Set(SOURCE.match(/js_rf_[a-z_]+/g))];
  for (const lang of Object.keys(I18N)) for (const key of keys) assert(typeof I18N[lang][key] === "string", lang + " lacks " + key);
  eq(Object.keys(I18N).length, 10, "languages");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log("ok   " + name);
    } catch (error) {
      failed++;
      console.log("FAIL " + name + "\n     " + error.message);
    }
  }
  console.log(failed ? "FAIL " + failed + " of " + cases.length : "OK " + cases.length + " cases");
  process.exitCode = failed ? 1 : 0;
})();
