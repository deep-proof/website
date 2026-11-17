// Inserts an article fragment into the article page (plan I9, I11).
// Usage: node tools/insert-article.js FRAGMENT [--page docs/ai-agents-misread-long-documents.html] [--expect <sha256>]
// FRAGMENT is the file build_article.py --out wrote; --expect is the sha256 it printed.
// The file's bytes are copied verbatim between the markers and their sha256 is written
// into the opening marker. A fragment with the DRAFT mark is inserted (for a preview) with
// a warning; tools/check-article.js refuses such a page.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { locateFragment, checkFragment } = require("./check-article.js");

function insertFragment(pagePath, fragmentPath, expect) {
  const bytes = fs.readFileSync(fragmentPath);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (expect && hash !== expect) throw new Error("fragment sha256 " + hash + " differs from --expect " + expect);
  const fragment = bytes.toString("utf8");
  if (Buffer.compare(Buffer.from(fragment, "utf8"), bytes) !== 0) throw new Error("fragment is not valid UTF-8");
  const problems = checkFragment(fragment, { allowDraft: true });
  if (problems.length) throw new Error("fragment refused:\n  - " + problems.join("\n  - "));
  const html = fs.readFileSync(pagePath, "utf8");
  const loc = locateFragment(html);
  if (loc.error) throw new Error(pagePath + ": " + loc.error);
  const head = html.slice(0, loc.start).replace(/sha256=[0-9a-f]{64} -->\n$/, "sha256=" + hash + " -->\n");
  fs.writeFileSync(pagePath, head + fragment + html.slice(loc.end));
  return { hash, draft: /\bDRAFT\b/.test(fragment) };
}

function main(argv) {
  const fragmentPath = argv[0];
  const pi = argv.indexOf("--page");
  const ei = argv.indexOf("--expect");
  const pagePath = pi >= 0 ? argv[pi + 1] : path.resolve(__dirname, "..", "docs", "ai-agents-misread-long-documents.html");
  const expect = ei >= 0 ? argv[ei + 1] : null;
  if (!fragmentPath || fragmentPath.startsWith("--") || !pagePath || (ei >= 0 && !/^[0-9a-f]{64}$/.test(expect || ""))) {
    console.error("usage: node tools/insert-article.js FRAGMENT [--page PAGE] [--expect <sha256>]");
    return 2;
  }
  try {
    const out = insertFragment(pagePath, fragmentPath, expect);
    console.log("inserted sha256=" + out.hash + " into " + pagePath);
    if (out.draft) console.log("warning: the fragment holds the DRAFT mark; tools/check-article.js will refuse the page");
    return 0;
  } catch (error) {
    console.error("refused: " + error.message);
    return 1;
  }
}

module.exports = { insertFragment };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
