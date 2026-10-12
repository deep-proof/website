// Checks docs/i18n: same keys in every language, same HTML tags per value, no ß in German, no cedilla ş/ţ in Romanian.
// Usage: node tools/check-i18n.js docs
const path = require("path"); const dir = process.argv[2];
global.window = {};
for (const l of ["en", "de", "fr", "it", "rm", "es", "nl", "pl", "pt", "ro"]) { try { require(path.resolve(dir, "i18n", l + ".js")); } catch (e) { console.log(l, "LOAD ERROR", e.message); } }
const D = window.DP_I18N, en = D.en;
const tags = (s) => (s.match(/<\/?[a-z]+[^>]*>/g) || []).map((t) => t.replace(/>.*$/, "")).sort().join("|");
const keep = /^(Deep Proof|AI Review Skills?|GPL-3\.0|GitHub|Outfinity.*|Axiologic Research|Northline.*|Community Edition.*|\d.*|[A-Z]{2}|Private equity|M&amp;A|Insurance|Consulting|Audit.*|Impressum|Pharma.*|KYC.*|CAPEX.*|Email:?|Web:?|axiologic\.net|outfinity\.ch)$/;
for (const l of ["de", "fr", "it", "rm", "es", "nl", "pl", "pt", "ro"]) {
  const d = D[l]; if (!d) continue; let bad = [], same = [];
  for (const k in en) {
    if (!(k in d)) bad.push("missing " + k);
    else if (tags(en[k]) !== tags(d[k])) bad.push("tags " + k);
    else if (d[k] === en[k] && !keep.test(en[k].replace(/<[^>]+>/g, "").trim())) same.push(k);
  }
  for (const k in d) if (!(k in en)) bad.push("extra " + k);
  if (l === "de" && Object.values(d).some((v) => v.includes("ß"))) bad.push("contains ß");
  if (l === "ro" && Object.values(d).some((v) => /[şţŞŢ]/.test(v))) bad.push("cedilla ş/ţ (use comma-below ș/ț)");
  console.log(l, bad.length ? "FAIL" : "OK", Object.keys(d).length, bad.slice(0, 10).join(", "), same.length ? "| unchanged: " + same.join(", ") : "");
}
