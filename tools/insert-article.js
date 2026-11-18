// Inserts an article fragment into the article page (plan I9, I11).
// Usage: node tools/insert-article.js FRAGMENT [--page docs/<article page>.html] [--expect <sha256>]
// FRAGMENT is the file build_article.py --out wrote; --expect is the sha256 it printed.
// --page is required when docs/ holds more than one article page (a page with an ARTICLE:BEGIN marker).
// The file's bytes are copied verbatim between the markers and their sha256 is written
// into the opening marker. A fragment with the DRAFT mark is inserted (for a preview) with
// a warning; tools/check-article.js refuses such a page.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { locateFragment, checkFragment, articlePages } = require("./check-article.js");

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

// The page to insert into: --page as given, else the one article page of docsDir.
// Returns { page } or { error }.
function resolvePage(docsDir, pageArg) {
  if (pageArg) return { page: pageArg };
  const names = articlePages(docsDir);
  if (names.length === 1) return { page: path.join(docsDir, names[0]) };
  if (!names.length) return { error: "no article page in " + docsDir + ": name the page with --page" };
  return { error: "--page is required: " + names.length + " article pages exist (" + names.join(", ") + ")" };
}

const USAGE = "usage: node tools/insert-article.js FRAGMENT [--page PAGE] [--expect <sha256>]";

function main(argv) {
  const fragmentPath = argv[0];
  const pi = argv.indexOf("--page");
  const ei = argv.indexOf("--expect");
  const expect = ei >= 0 ? argv[ei + 1] : null;
  const pageArg = pi >= 0 ? argv[pi + 1] : null;
  if (!fragmentPath || fragmentPath.startsWith("--") || (ei >= 0 && !/^[0-9a-f]{64}$/.test(expect || "")) || (pi >= 0 && (!pageArg || pageArg.startsWith("--")))) {
    console.error(USAGE);
    return 2;
  }
  let chosen;
  try { chosen = resolvePage(path.resolve(__dirname, "..", "docs"), pageArg); } catch (error) { console.error("refused: " + error.message); return 2; }
  if (chosen.error) {
    console.error(chosen.error);
    return 2;
  }
  const pagePath = chosen.page;
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

module.exports = { insertFragment, resolvePage };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
