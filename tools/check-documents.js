// Asks the Bizanso collector whether every document a page offers is live, before a push to main
// (managed documents plan J9, M6, acceptance B3 and B4).
// Usage: node tools/check-documents.js docs --origin https://deepproof.ch [--collector URL] [--allow-none]
// --collector replaces the address of report-form.js for a fake on this machine; a collector that is not local is
// accepted only when it equals COLLECTOR_URL of report-form.js. stderr names the collector's host; stdout holds only
// the result lines.
//        node tools/check-documents.js --self-test
// For each article page with a report form it reads the data-document of the form. For each distinct
// document it sends one POST of { site, form, document, consentVersion } with the given Origin, and prints
//   OK <page> <document>                  or      FAIL <page> <document> <reason>
// then the last line: checked <n> page(s) with a form, <m> document(s): <k> failed
// A page passes only when the answer is 422, its error is invalid_request, the keys of its `fields` are
// exactly name, email, company and consent, and it carries access-control-allow-origin equal to the origin
// sent: the collector then knows the document is live and the consent date accepted, and the reader's
// browser may read the answer. The request holds no personal data and creates no record.
// Exits 0 when at least one page with a form was found and every one passed (--allow-none accepts a site
// whose article pages have no form), 1 when one failed or none was found, 2 on a usage error.
// A reason is chosen in a fixed order; see ladder() below.
"use strict";
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { articlePages, pageForm, DOCUMENT_ID } = require("./check-article.js");

const REQUIRED_FIELDS = ["company", "consent", "email", "name"];
const REQUEST_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 65536;
const USAGE = "usage: node tools/check-documents.js docs --origin https://deepproof.ch [--collector URL] [--allow-none] | --self-test";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isLoopback = (host) => host === "127.0.0.1" || host === "localhost" || host === "[::1]";

// The constants of docs/report-form.js the request is built from.
function readConstants(docsDir) {
  const script = fs.readFileSync(path.join(docsDir, "report-form.js"), "utf8");
  const out = {};
  for (const [key, name] of [["collector", "COLLECTOR_URL"], ["site", "SITE_ID"], ["form", "FORM_ID"], ["consentVersion", "CONSENT_VERSION"]]) {
    const m = new RegExp('const ' + name + ' = "([^"]*)";').exec(script);
    if (!m || !m[1]) throw new Error("docs/report-form.js has no " + name + " constant");
    out[key] = m[1];
  }
  return out;
}

// One POST. Resolves { status, headers, body } and rejects on any transport failure. The http and https
// modules send exactly the headers given and never follow a redirect.
function postJson(collector, origin, payload, { timeoutMs, loopbackOnly }) {
  return new Promise((resolve, reject) => {
    const url = new URL(collector);
    if (loopbackOnly && !isLoopback(url.hostname)) return reject(new Error("the self-test sends to loopback only: " + url.hostname));
    const text = JSON.stringify(payload);
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, {
      method: "POST",
      agent: false,
      headers: { origin, "content-type": "application/json", "content-length": Buffer.byteLength(text), accept: "application/json" }
    }, (res) => {
      const chunks = [];
      let size = 0, oversized = false;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) oversized = true;
        else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("close", () => {
        if (!res.complete) return reject(new Error("the answer was cut off"));
        resolve({ status: res.statusCode, headers: res.headers, body: oversized ? null : Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(text);
  });
}

function parseBody(raw) {
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw); } catch (error) { return null; }
}

// The pass rule, computed on its own from the answer: every condition must hold.
function passes(res, origin) {
  const json = parseBody(res.body);
  if (res.status !== 422 || !isObject(json) || json.error !== "invalid_request" || !isObject(json.fields)) return false;
  if (Object.keys(json.fields).sort().join(",") !== REQUIRED_FIELDS.join(",")) return false;
  return res.headers["access-control-allow-origin"] === origin;
}

// The reason of a failure: the first that applies, in this order.
//   network, origin_refused (403), unknown_site (404 unknown_form), not_live (404 unknown_document),
//   unavailable (503), rate_limited (429), unexpected_<status> (any other status than 422),
//   collector_too_old (fields.document present), consent_version_refused (fields.consentVersion),
//   unexpected_fields (a 422 that is not the answer for a request with only the four fields missing),
//   no_cors_echo (everything else right, the origin not echoed).
// A 422 with a body that is not JSON, an error other than invalid_request or no `fields` object has no reason
// of its own in the plan: it is reported as unexpected_fields.
function ladder(res, origin) {
  const json = parseBody(res.body);
  if (res.status === 403) return "origin_refused";
  if (res.status === 404) {
    if (isObject(json) && json.error === "unknown_form") return "unknown_site";
    if (isObject(json) && json.error === "unknown_document") return "not_live";
    return "unexpected_404";
  }
  if (res.status === 503) return "unavailable";
  if (res.status === 429) return "rate_limited";
  if (res.status !== 422) return "unexpected_" + res.status;
  const fields = isObject(json) && isObject(json.fields) ? json.fields : null;
  if (fields && has(fields, "document")) return "collector_too_old";
  if (fields && has(fields, "consentVersion")) return "consent_version_refused";
  if (!fields || json.error !== "invalid_request" || Object.keys(fields).sort().join(",") !== REQUIRED_FIELDS.join(",")) return "unexpected_fields";
  return "no_cors_echo";
}

// One document: { reason: null } when it passes, else { reason }. A gap in the ladder can never print a pass.
// detail is the transport error of a network failure, which run() prints on stderr.
async function checkDocument(collector, origin, constants, documentId, opts) {
  let res;
  try {
    res = await postJson(collector, origin, { site: constants.site, form: constants.form, document: documentId, consentVersion: constants.consentVersion }, opts);
  } catch (error) {
    return { reason: "network", detail: error.message };
  }
  if (passes(res, origin)) return { reason: null };
  return { reason: ladder(res, origin) || "unexpected_fields" }; // a gap in the ladder is still a failure
}

function validOrigin(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch (error) { return false; }
}

function validCollector(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && isLoopback(url.hostname);
  } catch (error) { return false; }
}

// io: { out(line), err(line) }. opts: { timeoutMs, loopbackOnly }. Resolves the exit code.
async function run(argv, io, opts = {}) {
  const options = { timeoutMs: opts.timeoutMs || REQUEST_TIMEOUT_MS, loopbackOnly: !!opts.loopbackOnly };
  let docsDir = null, origin = null, collector = null, allowNone = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--origin" || arg === "--collector") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) { io.err(USAGE); return 2; }
      if (arg === "--origin") origin = value; else collector = value;
    } else if (arg === "--allow-none") allowNone = true;
    else if (arg.startsWith("--") || docsDir !== null) { io.err(USAGE); return 2; }
    else docsDir = arg;
  }
  if (!docsDir || !origin) { io.err(USAGE); return 2; }
  if (!validOrigin(origin)) { io.err("--origin must be an origin such as https://deepproof.ch (scheme, host and port, nothing else)"); return 2; }
  if (collector !== null && !validCollector(collector)) { io.err("--collector must be an https address (http only for localhost, 127.0.0.1 or [::1])"); return 2; }
  let isDir = false;
  try { isDir = fs.statSync(docsDir).isDirectory(); } catch (error) { /* reported below */ }
  if (!isDir) { io.err("folder not found: " + docsDir); return 2; }

  // The pages with a form, in the order of their names.
  const pages = [];
  for (const name of articlePages(docsDir)) {
    const form = pageForm(fs.readFileSync(path.join(docsDir, name), "utf8"));
    if (form) pages.push({ name, document: form.document !== null && DOCUMENT_ID.test(form.document) ? form.document : null });
  }
  if (!pages.length) {
    io.err("no article page with a report form found in " + docsDir);
    io.out("checked 0 page(s) with a form, 0 document(s): 0 failed");
    return allowNone ? 0 : 1;
  }

  let constants;
  try { constants = readConstants(docsDir); } catch (error) { io.err(error.message); return 2; }
  if (!validCollector(constants.collector)) { io.err("COLLECTOR_URL in docs/report-form.js is not an https address (http only for localhost, 127.0.0.1 or [::1]): " + constants.collector); return 2; }
  if (collector === null) collector = constants.collector;
  // A collector that is not on this machine is asked only when it is the one the form itself posts to.
  else if (!isLoopback(new URL(collector).hostname) && collector !== constants.collector) {
    io.err("--collector " + collector + " is not on this machine and differs from COLLECTOR_URL in docs/report-form.js; nothing was sent");
    return 2;
  }
  io.err("collector: " + new URL(collector).host);

  const results = new Map(); // document -> null (pass) or reason; one request per distinct document
  for (const page of pages) {
    if (page.document === null || results.has(page.document)) continue;
    const outcome = await checkDocument(collector, origin, constants, page.document, options);
    results.set(page.document, outcome.reason);
    if (outcome.detail) io.err(page.document + ": " + outcome.detail);
  }
  let failed = 0;
  for (const page of pages) {
    if (page.document === null) { failed++; io.out("FAIL " + page.name + " - no_document"); continue; }
    const reason = results.get(page.document);
    if (reason === null) io.out("OK " + page.name + " " + page.document);
    else { failed++; io.out("FAIL " + page.name + " " + page.document + " " + reason); }
  }
  io.out("checked " + pages.length + " page(s) with a form, " + results.size + " document(s): " + failed + " failed");
  return failed ? 1 : 0;
}

/* ---------- Self-test (plan B3): the same code against a fake collector on 127.0.0.1 ---------- */
const ORIGIN = "https://deepproof.ch";
const FIELDS_OK = { name: "required", email: "required", company: "required", consent: "required" };
const echo = (origin) => (typeof origin === "string" ? { "access-control-allow-origin": origin } : {});

// A fake collector. handler(record) returns { status, headers, body, hang, destroy }; body is JSON-encoded unless a string.
function startFake(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const record = { method: req.method, url: req.url, headers: req.headers, raw, body: parseBody(raw) };
      requests.push(record);
      const answer = handler(record) || {};
      if (answer.destroy) return req.socket.destroy();
      if (answer.hang) return;
      if (answer.truncate) {
        // The head promises 4,096 bytes; a few arrive and the connection is cut.
        res.writeHead(answer.status, { "content-type": "application/json", "content-length": 4096, ...(answer.headers || {}) });
        res.write('{"error":"invalid_request","fields":{"name":"required",');
        return setTimeout(() => req.socket.destroy(), 30);
      }
      const body = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body === undefined ? {} : answer.body);
      res.writeHead(answer.status === undefined ? 200 : answer.status, { "content-type": "application/json", ...(answer.headers || {}) });
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: "http://127.0.0.1:" + server.address().port + "/visitor-data/v1/submissions",
    port: server.address().port,
    requests,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); })
  })));
}

const okAnswer = (record) => ({ status: 422, headers: echo(record.headers.origin), body: { error: "invalid_request", fields: FIELDS_OK } });

// A docs folder: report-form.js with the constants, article pages (with or without a form), and a page that is not an article.
function makeDocs(tmp, spec) {
  const dir = fs.mkdtempSync(path.join(tmp, "docs-"));
  const c = { collector: "http://127.0.0.1:1/never", site: "deepproof", form: "report-request", consent: "2026-11-17", ...(spec.constants || {}) };
  if (!spec.noScript) {
    fs.writeFileSync(path.join(dir, "report-form.js"), [
      "(function () {",
      '  const COLLECTOR_URL = "' + c.collector + '";',
      '  const LINK_HOST = "bizanso.com";',
      '  const SITE_ID = "' + c.site + '";',
      '  const FORM_ID = "' + c.form + '";',
      '  const CONSENT_VERSION = "' + c.consent + '";',
      "})();", ""
    ].join("\n"));
  }
  for (const page of spec.pages || []) {
    let form = "";
    if (page.form === "tag") form = '<form id="report-request-form" class="x" method="post" novalidate' + (page.document === undefined ? "" : ' data-document="' + page.document + '"') + "></form>";
    fs.writeFileSync(path.join(dir, page.name), "<!doctype html>\n<html><body>\n<!-- ARTICLE:BEGIN sha256=" + "0".repeat(64) + " -->\n<article lang=\"en\" class=\"article-copy\"><h1>x</h1></article>\n<!-- ARTICLE:END -->\n" + form + "\n</body></html>\n");
  }
  // Not an article page (no marker): a form here must be ignored.
  fs.writeFileSync(path.join(dir, "about.html"), '<html><body><form id="report-request-form" data-document="not-an-article"></form></body></html>\n');
  return dir;
}
const pageWith = (name, document) => ({ name, form: "tag", document });

async function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-documents-"));
  const results = [];
  let failures = 0;
  const watchdog = setTimeout(() => { console.error("SELF-TEST TIMEOUT"); process.exit(1); }, 120000);
  watchdog.unref();
  const record = (name, ok, detail) => { if (!ok) failures++; results.push((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "\n     " + detail)); };

  // One run of the tool in this process against a fake collector (or none). spec.handler answers; spec.args adds options.
  async function scenario(name, spec) {
    const fake = spec.noFake ? null : await startFake(spec.handler || okAnswer);
    const decoy = spec.decoyHandler ? await startFake(spec.decoyHandler) : null;
    try {
      const constants = { collector: fake ? fake.url : "http://127.0.0.1:1/never", ...(spec.constants || {}) };
      if (spec.constantsCollector) constants.collector = spec.constantsCollector(fake, decoy);
      const dir = spec.docs ? spec.docs(tmp, fake, decoy) : makeDocs(tmp, { pages: spec.pages, constants, noScript: spec.noScript });
      const lines = [], errs = [];
      const argv = spec.argv ? spec.argv(dir, fake, decoy) : [dir, "--origin", spec.origin || ORIGIN, ...(spec.args ? spec.args(fake, decoy) : [])];
      const code = await run(argv, { out: (l) => lines.push(l), err: (l) => errs.push(l) }, { timeoutMs: spec.timeoutMs || 3000, loopbackOnly: true });
      const want = spec.expect;
      const problems = [];
      if (code !== want.code) problems.push("exit code " + code + ", expected " + want.code);
      if (want.lines && JSON.stringify(lines) !== JSON.stringify(want.lines)) problems.push("output " + JSON.stringify(lines) + ", expected " + JSON.stringify(want.lines));
      const sent = fake ? fake.requests : [];
      if (want.requests !== undefined && sent.length !== want.requests) problems.push(sent.length + " request(s) sent, expected " + want.requests);
      if (decoy && decoy.requests.length !== (want.decoyRequests || 0)) problems.push(decoy.requests.length + " request(s) reached the second server");
      if (want.check) { const extra = want.check({ lines, errs, requests: sent, dir }); if (extra) problems.push(extra); }
      record(name, problems.length === 0, problems.join("; "));
    } finally {
      if (fake) await fake.close();
      if (decoy) await decoy.close();
    }
  }

  const PAGE_A = "first.html", PAGE_B = "second.html";
  const one = (reasonLine, code, extra = {}) => ({ code, lines: [reasonLine, "checked 1 page(s) with a form, 1 document(s): " + (code === 0 ? 0 : 1) + " failed"], requests: 1, ...extra });
  const fails = (reason, extra) => one("FAIL " + PAGE_A + " doc-a " + reason, 1, extra);
  const failCase = (name, handler, reason, extra = {}) => scenario(name, { pages: [pageWith(PAGE_A, "doc-a")], handler, expect: fails(reason, extra) });
  const withFields = (fields, o = {}) => (record) => ({ status: o.status || 422, headers: o.noEcho ? {} : echo("echo" in o ? o.echo : record.headers.origin), body: o.body || { error: o.error || "invalid_request", fields } });

  // 1. The pass, and exactly what was sent.
  await scenario("a live document passes; one POST of exactly site, form, document and consentVersion with the origin", {
    pages: [pageWith(PAGE_A, "llm-document-failures")],
    constants: { site: "deepproof", form: "report-request", consent: "2026-11-17" },
    constantsCollector: (fake) => fake.url,
    expect: {
      code: 0, lines: ["OK " + PAGE_A + " llm-document-failures", "checked 1 page(s) with a form, 1 document(s): 0 failed"], requests: 1,
      check: ({ requests }) => {
        const r = requests[0];
        if (r.method !== "POST") return "method " + r.method;
        if (r.url !== "/visitor-data/v1/submissions") return "path " + r.url;
        if (r.headers.origin !== ORIGIN) return "origin " + r.headers.origin;
        if (r.headers["content-type"] !== "application/json") return "content-type " + r.headers["content-type"];
        if (JSON.stringify(r.body) !== JSON.stringify({ site: "deepproof", form: "report-request", document: "llm-document-failures", consentVersion: "2026-11-17" })) return "body " + r.raw;
        if (r.headers.cookie || r.headers.authorization) return "credentials sent";
        return null;
      }
    }
  });
  await scenario("the body uses the site, form and consent version of report-form.js, and the origin of --origin", {
    pages: [pageWith(PAGE_A, "doc-a")], constants: { site: "othersite", form: "other-form", consent: "2026-01-02" }, origin: "http://localhost:8080",
    expect: { code: 0, requests: 1, check: ({ requests }) => (JSON.stringify(requests[0].body) === JSON.stringify({ site: "othersite", form: "other-form", document: "doc-a", consentVersion: "2026-01-02" }) && requests[0].headers.origin === "http://localhost:8080" ? null : requests[0].raw + " " + requests[0].headers.origin) }
  });
  await scenario("the real docs folder with --collector set to the fake: the request B4 sends, built from docs/report-form.js", {
    noFake: false, handler: okAnswer,
    docs: () => path.resolve(__dirname, "..", "docs"),
    args: (fake) => ["--collector", fake.url],
    expect: {
      code: 0, requests: 1,
      check: ({ requests, lines }) => {
        const script = fs.readFileSync(path.resolve(__dirname, "..", "docs", "report-form.js"), "utf8");
        const consent = /const CONSENT_VERSION = "([^"]*)";/.exec(script)[1];
        const want = { site: "deepproof", form: "report-request", document: "llm-document-failures", consentVersion: consent };
        if (JSON.stringify(requests[0].body) !== JSON.stringify(want)) return "body " + requests[0].raw;
        if (requests[0].headers.origin !== ORIGIN) return "origin " + requests[0].headers.origin;
        return lines[0] === "OK ai-agents-misread-long-documents.html llm-document-failures" ? null : "lines " + JSON.stringify(lines);
      }
    }
  });
  await scenario("--collector overrides the address in report-form.js", {
    pages: [pageWith(PAGE_A, "doc-a")], constantsCollector: (fake, decoy) => decoy.url, decoyHandler: okAnswer,
    args: (fake) => ["--collector", fake.url],
    expect: { code: 0, requests: 1, decoyRequests: 0 }
  });
  await scenario("without --collector the address of report-form.js is used", {
    pages: [pageWith(PAGE_A, "doc-a")], constantsCollector: (fake, decoy) => decoy.url, decoyHandler: okAnswer, noFake: false,
    expect: { code: 0, requests: 0, decoyRequests: 1 }
  });

  // 2. One case per reason, with the answer that gives it.
  {
    const probe = await startFake(okAnswer);
    const closedUrl = probe.url;
    await probe.close();
    await scenario("network: a closed port", { noFake: true, pages: [pageWith(PAGE_A, "doc-a")], args: () => ["--collector", closedUrl], expect: { code: 1, lines: ["FAIL " + PAGE_A + " doc-a network", "checked 1 page(s) with a form, 1 document(s): 1 failed"] } });
  }
  await failCase("network: the connection is cut without an answer", () => ({ destroy: true }), "network");
  await scenario("network: no answer within the timeout", { pages: [pageWith(PAGE_A, "doc-a")], handler: () => ({ hang: true }), timeoutMs: 300, expect: fails("network") });
  await failCase("origin_refused: 403 origin_not_allowed with no CORS header", () => ({ status: 403, body: { error: "origin_not_allowed" } }), "origin_refused");
  await failCase("origin_refused: 403 with an echo and any body", (r) => ({ status: 403, headers: echo(r.headers.origin), body: "forbidden" }), "origin_refused");
  await failCase("unknown_site: 404 unknown_form", () => ({ status: 404, body: { error: "unknown_form" } }), "unknown_site");
  await failCase("not_live: 404 unknown_document", () => ({ status: 404, body: { error: "unknown_document" } }), "not_live");
  await failCase("unexpected_404: 404 with another error", () => ({ status: 404, body: { error: "not_found" } }), "unexpected_404");
  await failCase("unexpected_404: 404 with no JSON", () => ({ status: 404, body: "<html>not found</html>" }), "unexpected_404");
  await failCase("unavailable: 503 no_report with an echo", (r) => ({ status: 503, headers: echo(r.headers.origin), body: { error: "unavailable", reason: "no_report" } }), "unavailable");
  await failCase("unavailable: 503 with no body", () => ({ status: 503, body: "" }), "unavailable");
  await failCase("rate_limited: 429 with no echo", () => ({ status: 429, body: { error: "rate_limited", retryAfterSeconds: 60 } }), "rate_limited");
  await failCase("unexpected_500", () => ({ status: 500, body: { error: "internal" } }), "unexpected_500");
  await failCase("unexpected_200: a 200 is not a pass", (r) => ({ status: 200, headers: echo(r.headers.origin), body: { error: "invalid_request", fields: FIELDS_OK } }), "unexpected_200");
  await failCase("unexpected_201: a record was created, which is never a pass", (r) => ({ status: 201, headers: echo(r.headers.origin), body: { status: "created", downloadUrl: "x", expiresAt: "y" } }), "unexpected_201");
  await failCase("unexpected_400", (r) => ({ status: 400, headers: echo(r.headers.origin), body: { error: "invalid_json" } }), "unexpected_400");
  {
    // The redirect must lead to a live second server so that a followed redirect would be seen.
    const target = await startFake(okAnswer);
    const fake = await startFake(() => ({ status: 307, headers: { location: target.url }, body: "" }));
    const dir = makeDocs(tmp, { pages: [pageWith(PAGE_A, "doc-a")], constants: { collector: fake.url } });
    const lines = [];
    const code = await run([dir, "--origin", ORIGIN], { out: (l) => lines.push(l), err: () => {} }, { timeoutMs: 3000, loopbackOnly: true });
    record("unexpected_307: a redirect to a live collector is not followed (the target gets no request)", code === 1 && lines[0] === "FAIL " + PAGE_A + " doc-a unexpected_307" && fake.requests.length === 1 && target.requests.length === 0, JSON.stringify({ code, lines, hits: fake.requests.length, target: target.requests.length }));
    await fake.close();
    await target.close();
  }
  await failCase("collector_too_old: 422 that names fields.document", withFields({ document: "invalid", name: "required", email: "required", company: "required", consent: "required" }), "collector_too_old");
  await failCase("collector_too_old: fields.document alone", withFields({ document: "unknown" }), "collector_too_old");
  await failCase("collector_too_old: an answer that names both document and consentVersion", withFields({ document: "invalid", consentVersion: "invalid", name: "required" }), "collector_too_old");
  await failCase("collector_too_old: without an echo and with another error", withFields({ document: "x" }, { noEcho: true, error: "other" }), "collector_too_old");
  await failCase("consent_version_refused: fields.consentVersion alone", withFields({ consentVersion: "invalid" }), "consent_version_refused");
  await failCase("consent_version_refused: with the four fields and an echo", withFields({ ...FIELDS_OK, consentVersion: "invalid" }), "consent_version_refused");
  await failCase("consent_version_refused: before unexpected_fields (a wrong key set)", withFields({ consentVersion: "invalid", name: "required", website: "x" }), "consent_version_refused");

  await failCase("network: a correct 422 whose body is cut off is not a pass", (r) => ({ status: 422, headers: echo(r.headers.origin), truncate: true }), "network");
  await failCase("unexpected_fields: a correct 422 whose body is over 64 KiB is not read", (r) => ({ status: 422, headers: echo(r.headers.origin), body: JSON.stringify({ error: "invalid_request", fields: FIELDS_OK, pad: "x".repeat(70000) }) }), "unexpected_fields");

  // 3. 422 answers that are not the four fields, whatever else is right.
  for (const [label, handler] of [
    ["empty fields", withFields({})],
    ["a shorter set (no consent)", withFields({ name: "required", email: "required", company: "required" })],
    ["a single field", withFields({ name: "required" })],
    ["an extra key (comment)", withFields({ ...FIELDS_OK, comment: "invalid" })],
    ["a different key (website for consent)", withFields({ name: "required", email: "required", company: "required", website: "x" })],
    ["fields is null", withFields(null)],
    ["fields is an array of the four names", withFields(["name", "email", "company", "consent"])],
    ["fields is a string", withFields("name,email,company,consent")],
    ["no fields key", (r) => ({ status: 422, headers: echo(r.headers.origin), body: { error: "invalid_request" } })],
    ["error other than invalid_request", withFields(FIELDS_OK, { error: "bad_request" })],
    ["a body that is not JSON", (r) => ({ status: 422, headers: echo(r.headers.origin), body: "<html>nope</html>" })],
    ["a JSON array body", (r) => ({ status: 422, headers: echo(r.headers.origin), body: [FIELDS_OK] })],
    ["an empty body", (r) => ({ status: 422, headers: echo(r.headers.origin), body: "" })],
    ["a lookalike key (Name)", withFields({ Name: "required", email: "required", company: "required", consent: "required" })]
  ]) await failCase("unexpected_fields: " + label, handler, "unexpected_fields");
  await failCase("unexpected_fields: empty fields also without an echo (before no_cors_echo)", withFields({}, { noEcho: true }), "unexpected_fields");

  // 4. The origin echo.
  await failCase("no_cors_echo: the four fields and no access-control-allow-origin", withFields(FIELDS_OK, { noEcho: true }), "no_cors_echo");
  await failCase("no_cors_echo: the header is *", withFields(FIELDS_OK, { echo: "*" }), "no_cors_echo");
  await failCase("no_cors_echo: the header names another origin", withFields(FIELDS_OK, { echo: "https://other.example" }), "no_cors_echo");
  await failCase("no_cors_echo: the header has a trailing slash", withFields(FIELDS_OK, { echo: ORIGIN + "/" }), "no_cors_echo");
  await failCase("no_cors_echo: the header is empty", withFields(FIELDS_OK, { echo: "" }), "no_cors_echo");
  await failCase("no_cors_echo: the header differs in case", withFields(FIELDS_OK, { echo: "https://DeepProof.ch" }), "no_cors_echo");
  await failCase("no_cors_echo: the header is null", withFields(FIELDS_OK, { echo: "null" }), "no_cors_echo");

  // 5. Pages.
  for (const [label, document] of [["missing", undefined], ["malformed (Bad Id)", "Bad Id"], ["empty", ""], ["a path", "../x"], ["65 characters", "a".repeat(65)]]) {
    await scenario("no_document: data-document " + label + " sends nothing", {
      pages: [pageWith(PAGE_A, document)],
      expect: { code: 1, lines: ["FAIL " + PAGE_A + " - no_document", "checked 1 page(s) with a form, 0 document(s): 1 failed"], requests: 0 }
    });
  }
  await scenario("two pages with the same document send one request and print two lines", {
    pages: [pageWith(PAGE_A, "doc-a"), pageWith(PAGE_B, "doc-a")],
    expect: { code: 0, lines: ["OK " + PAGE_A + " doc-a", "OK " + PAGE_B + " doc-a", "checked 2 page(s) with a form, 1 document(s): 0 failed"], requests: 1 }
  });
  await scenario("two pages with two documents: one live, one not; two requests, exit 1", {
    pages: [pageWith(PAGE_A, "doc-a"), pageWith(PAGE_B, "doc-b")],
    handler: (r) => (r.body && r.body.document === "doc-b" ? { status: 404, body: { error: "unknown_document" } } : okAnswer(r)),
    expect: { code: 1, lines: ["OK " + PAGE_A + " doc-a", "FAIL " + PAGE_B + " doc-b not_live", "checked 2 page(s) with a form, 2 document(s): 1 failed"], requests: 2 }
  });
  await scenario("a failing document fails every page that names it", {
    pages: [pageWith(PAGE_A, "doc-a"), pageWith(PAGE_B, "doc-a")], handler: () => ({ status: 503, body: { error: "unavailable" } }),
    expect: { code: 1, lines: ["FAIL " + PAGE_A + " doc-a unavailable", "FAIL " + PAGE_B + " doc-a unavailable", "checked 2 page(s) with a form, 1 document(s): 2 failed"], requests: 1 }
  });
  await scenario("a page with no document next to a live page: the live one is checked, exit 1", {
    pages: [pageWith(PAGE_A, "doc-a"), pageWith(PAGE_B, undefined)],
    expect: { code: 1, lines: ["OK " + PAGE_A + " doc-a", "FAIL " + PAGE_B + " - no_document", "checked 2 page(s) with a form, 1 document(s): 1 failed"], requests: 1 }
  });
  await scenario("an article page without a form is skipped, and a form on a page that is not an article is ignored", {
    pages: [pageWith(PAGE_A, "doc-a"), { name: PAGE_B, form: "none" }],
    expect: { code: 0, lines: ["OK " + PAGE_A + " doc-a", "checked 1 page(s) with a form, 1 document(s): 0 failed"], requests: 1, check: ({ requests }) => (requests[0].body.document === "not-an-article" ? "the form of about.html was used" : null) }
  });
  await scenario("a folder with no article page exits 1 and sends nothing", {
    pages: [], expect: { code: 1, lines: ["checked 0 page(s) with a form, 0 document(s): 0 failed"], requests: 0 }
  });
  await scenario("--allow-none: a folder with no article page exits 0", {
    pages: [], args: () => ["--allow-none"], expect: { code: 0, lines: ["checked 0 page(s) with a form, 0 document(s): 0 failed"], requests: 0 }
  });
  await scenario("an article page without a form exits 1", {
    pages: [{ name: PAGE_A, form: "none" }], expect: { code: 1, lines: ["checked 0 page(s) with a form, 0 document(s): 0 failed"], requests: 0 }
  });
  await scenario("--allow-none: an article page without a form exits 0", {
    pages: [{ name: PAGE_A, form: "none" }], args: () => ["--allow-none"], expect: { code: 0, requests: 0 }
  });
  await scenario("--allow-none does not excuse a failing page", {
    pages: [pageWith(PAGE_A, "doc-a")], args: () => ["--allow-none"], handler: () => ({ status: 404, body: { error: "unknown_document" } }), expect: fails("not_live")
  });
  await scenario("--allow-none does not excuse a page with no document", {
    pages: [pageWith(PAGE_A, undefined)], args: () => ["--allow-none"], expect: { code: 1, requests: 0 }
  });

  // 6. Usage errors (exit 2), none of which sends anything.
  const usage = (name, argv, extra = {}) => scenario(name, { pages: [pageWith(PAGE_A, "doc-a")], argv, expect: { code: 2, requests: 0, ...extra } });
  await usage("a folder that does not exist exits 2", (dir) => [path.join(dir, "no-such-folder"), "--origin", ORIGIN]);
  await usage("a path that is a file exits 2", (dir) => [path.join(dir, "report-form.js"), "--origin", ORIGIN]);
  await usage("no folder exits 2", () => ["--origin", ORIGIN]);
  await usage("no --origin exits 2", (dir) => [dir]);
  for (const bad of ["deepproof.ch", "https://deepproof.ch/", "https://deepproof.ch/path", "ftp://deepproof.ch", "https://", "", "https://deepproof.ch?x=1"]) {
    await usage("--origin '" + bad + "' exits 2", (dir) => [dir, "--origin", bad]);
  }
  await usage("--origin with no value exits 2", (dir) => [dir, "--origin"]);
  await usage("--collector with no value exits 2", (dir) => [dir, "--origin", ORIGIN, "--collector"]);
  await usage("--collector that is not an address exits 2", (dir) => [dir, "--origin", ORIGIN, "--collector", "not an address"]);
  await usage("--collector with another scheme exits 2", (dir) => [dir, "--origin", ORIGIN, "--collector", "ftp://127.0.0.1/x"]);
  await usage("--collector over http to a host that is not local exits 2", (dir) => [dir, "--origin", ORIGIN, "--collector", "http://example.com/x"]);
  await usage("an unknown option exits 2", (dir) => [dir, "--origin", ORIGIN, "--force"]);
  await usage("a second folder exits 2", (dir) => [dir, dir, "--origin", ORIGIN]);
  await scenario("a folder with a form page and no report-form.js exits 2 and sends nothing", { pages: [pageWith(PAGE_A, "doc-a")], noScript: true, expect: { code: 2, requests: 0 } });
  await scenario("a report-form.js without CONSENT_VERSION exits 2 and sends nothing", {
    pages: [pageWith(PAGE_A, "doc-a")], expect: { code: 2, requests: 0 },
    docs: (t, fake) => { const d = makeDocs(t, { pages: [pageWith(PAGE_A, "doc-a")], constants: { collector: fake.url } }); fs.writeFileSync(path.join(d, "report-form.js"), fs.readFileSync(path.join(d, "report-form.js"), "utf8").replace(/const CONSENT_VERSION = "[^"]*";/, "")); return d; }
  });
  await scenario("an unset consent version is sent as it is (the collector refuses it)", {
    pages: [pageWith(PAGE_A, "doc-a")], constants: { consent: "UNSET-awaiting-owner-approval" },
    handler: withFields({ consentVersion: "invalid" }), expect: fails("consent_version_refused", { check: ({ requests }) => (requests[0].body.consentVersion === "UNSET-awaiting-owner-approval" ? null : requests[0].raw) })
  });

  // The collector the tool asks, and which one it may ask. The host in these cases is a reserved name that never
  // resolves (RFC 2606), so even a broken guard sends nothing to a real host; the stderr message proves that the
  // guard, and not a failed lookup, refused it.
  await scenario("stderr names the collector's host and stdout holds only the result lines", {
    pages: [pageWith(PAGE_A, "doc-a")],
    expect: { code: 0, lines: ["OK " + PAGE_A + " doc-a", "checked 1 page(s) with a form, 1 document(s): 0 failed"], requests: 1, check: ({ errs, requests }) => (errs.length === 1 && errs[0].startsWith("collector: 127.0.0.1:") ? null : "stderr " + JSON.stringify(errs)) }
  });
  await scenario("COLLECTOR_URL over http to a host that is not local exits 2 and sends nothing", {
    pages: [pageWith(PAGE_A, "doc-a")], constants: { collector: "http://collector.invalid/visitor-data/v1/submissions" },
    expect: { code: 2, requests: 0, check: ({ errs }) => (errs.some((e) => e.includes("COLLECTOR_URL")) ? null : "stderr " + JSON.stringify(errs)) }
  });
  await scenario("a --collector that is not local and differs from COLLECTOR_URL exits 2 and sends nothing", {
    pages: [pageWith(PAGE_A, "doc-a")], args: () => ["--collector", "https://collector.invalid/visitor-data/v1/submissions"],
    expect: { code: 2, requests: 0, check: ({ errs }) => (errs.length === 1 && errs[0].includes("nothing was sent") ? null : "stderr " + JSON.stringify(errs)) }
  });
  await scenario("network: the self-test refuses a non-loopback collector (a reserved .invalid name, equal to COLLECTOR_URL), and says so", {
    pages: [pageWith(PAGE_A, "doc-a")], noFake: true, constants: { collector: "https://collector.invalid/visitor-data/v1/submissions" },
    args: () => ["--collector", "https://collector.invalid/visitor-data/v1/submissions"],
    expect: { code: 1, lines: ["FAIL " + PAGE_A + " doc-a network", "checked 1 page(s) with a form, 1 document(s): 1 failed"], check: ({ errs }) => (errs[0] === "collector: collector.invalid" && errs[1].includes("loopback only") ? null : "stderr " + JSON.stringify(errs)) }
  });

  // 7. The exit code and the output of the real command, in a child process (the fake runs here, so the child is async).
  const runChild = (args) => new Promise((resolve) => execFile(process.execPath, [__filename, ...args], { timeout: 30000, env: { ...process.env, CHECK_DOCUMENTS_LOOPBACK_ONLY: "1" } }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout, stderr })));
  {
    const fake = await startFake(okAnswer);
    const dir = makeDocs(tmp, { pages: [pageWith(PAGE_A, "doc-a")], constants: { collector: fake.url } });
    const bad = makeDocs(tmp, { pages: [pageWith(PAGE_A, "doc-a")], constants: { collector: fake.url } });
    const r0 = await runChild([dir, "--origin", ORIGIN]);
    record("the command exits 0 and prints OK and the count for a live document", r0.code === 0 && r0.stdout === "OK " + PAGE_A + " doc-a\nchecked 1 page(s) with a form, 1 document(s): 0 failed\n", JSON.stringify(r0));
    await fake.close();
    const closed = await runChild([bad, "--origin", ORIGIN]);
    record("the command exits 1 when the collector cannot be reached", closed.code === 1 && closed.stdout.startsWith("FAIL " + PAGE_A + " doc-a network\n"), JSON.stringify(closed));
    const missing = await runChild([path.join(tmp, "no-such-folder"), "--origin", ORIGIN]);
    record("the command exits 2 for a folder that does not exist", missing.code === 2 && missing.stdout === "", JSON.stringify(missing));
    const file = await runChild([path.join(dir, "report-form.js"), "--origin", ORIGIN]);
    record("the command exits 2 for a path that is a file", file.code === 2, JSON.stringify(file));
    const noOrigin = await runChild([dir]);
    record("the command exits 2 without --origin", noOrigin.code === 2 && noOrigin.stderr.includes("usage"), JSON.stringify(noOrigin));
    const none = await runChild([makeDocs(tmp, { pages: [] }), "--origin", ORIGIN]);
    record("the command exits 1 when no page with a form is found", none.code === 1, JSON.stringify(none));
    const guardDocs = makeDocs(tmp, { pages: [pageWith(PAGE_A, "doc-a")], constants: { collector: "https://collector.invalid/visitor-data/v1/submissions" } });
    const guarded = await runChild([guardDocs, "--origin", ORIGIN]);
    record("a child of the self-test refuses a collector that is not on loopback (the environment setting restricts it)", guarded.code === 1 && guarded.stdout.startsWith("FAIL " + PAGE_A + " doc-a network\n") && guarded.stderr.includes("loopback only: collector.invalid"), JSON.stringify(guarded));
    const allow = await runChild([makeDocs(tmp, { pages: [] }), "--origin", ORIGIN, "--allow-none"]);
    record("the command exits 0 with --allow-none when no page with a form is found", allow.code === 0, JSON.stringify(allow));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(results.join("\n"));
  console.log(failures ? "SELF-TEST FAIL " + failures : "SELF-TEST OK " + results.length + " cases");
  return failures ? 1 : 0;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const io = { out: (line) => console.log(line), err: (line) => console.error(line) };
  // The self-test sets CHECK_DOCUMENTS_LOOPBACK_ONLY=1 for the commands it starts: a setting that can only restrict.
  const loopbackOnly = process.env.CHECK_DOCUMENTS_LOOPBACK_ONLY === "1";
  (argv[0] === "--self-test" ? selfTest() : run(argv, io, { loopbackOnly })).then(
    (code) => { process.exitCode = code; },
    (error) => { console.error("check-documents failed: " + (error && error.stack || error)); process.exitCode = 1; }
  );
}

module.exports = { run, ladder, passes, readConstants };
