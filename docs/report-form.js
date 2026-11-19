// Report request form of an article page (for example ai-agents-misread-long-documents.html).
// A classic script loaded after script.js: it uses t() and currentLang from there when they
// exist (another website may not have them: see text() and language() below) and redraws
// its own texts on the "dp:language" event that applyLanguage() dispatches.
// The form names the document it asks for in data-document. The script sends the form to the
// Bizanso visitor data collector and shows the personal link.
(function () {
  "use strict";

  /* ---------- Contract with Bizanso (plan I1, I2, I10) ---------- */
  // Changing any of these is a change in two repositories (bizanso sites.mjs).
  const COLLECTOR_URL = "https://bizanso.com/base-agent-additional-server/bizanso/8787/visitor-data/v1/submissions";
  const LINK_HOST = "bizanso.com";
  const SITE_ID = "deepproof";
  const FORM_ID = "report-request";
  // The date (YYYY-MM-DD) on which the owner approves the consent text (rf_consent).
  // UNSET until then: the form sends nothing and tools/check-article.js refuses the page.
  const CONSENT_VERSION = "2026-11-18";
  const REQUEST_TIMEOUT_MS = 20000;
  // The document id pattern of the collector (bizanso sites.mjs): the same text as in tools/check-article.js.
  const DOCUMENT_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
  const LANGUAGES = ["en", "de", "es", "fr", "it", "nl", "pl", "pt", "rm", "ro"];
  // The English texts used when the page has no t(); tools/test-report-form.js keeps them equal to i18n/en.js.
  const FALLBACK_TEXTS = {
    js_copy_failed: "Copy failed: please select the text manually",
    js_rf_sending: "Sending\u2026",
    js_rf_success: "Your personal link to the report:",
    js_rf_expires: "The link works until {date}, for at most 20 downloads.",
    js_rf_no_email: "No email is sent: keep this link or download the report now.",
    js_rf_copy: "Copy link",
    js_rf_copied: "Link copied",
    js_rf_invalid: "Please check the marked fields.",
    js_rf_field_required: "Please fill in this field (at least 2 characters).",
    js_rf_field_email: "Please enter a valid email address.",
    js_rf_field_long: "This text is too long.",
    js_rf_consent_required: "Please confirm that you agree.",
    js_rf_rate_limited: "Too many requests. Please try again in {minutes} minutes.",
    js_rf_unavailable: "The report cannot be requested right now. Please try again later."
  };

  const LIMITS = {
    name: { required: true, min: 2, max: 120 },
    email: { required: true, min: 1, max: 254 },
    company: { required: true, min: 2, max: 160 },
    comment: { required: false, min: 0, max: 1000 }
  };
  const FIELDS = ["name", "email", "company", "comment", "consent"];
  const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

  // t() and currentLang of script.js when the page has them, else built-in English and the page's lang attribute.
  function text(key) {
    if (typeof t === "function") return t(key);
    return FALLBACK_TEXTS[key] || key;
  }
  function language() {
    try {
      if (typeof currentLang === "string" && currentLang) return currentLang;
    } catch (error) {}
    const lang = String((document.documentElement && document.documentElement.lang) || "").toLowerCase().split("-")[0];
    return lang;
  }

  const form = document.getElementById("report-request-form");
  if (!form) return;
  // The one value that differs per page: the document this page's form asks for.
  const documentId = form.dataset && typeof form.dataset.document === "string" ? form.dataset.document : "";
  const documentKnown = DOCUMENT_ID.test(documentId);
  const submitButton = document.getElementById("rf-submit");
  const statusLine = document.getElementById("rf-status");
  const result = document.getElementById("rf-result");
  const successLine = document.getElementById("rf-success");
  const link = document.getElementById("rf-link");
  const expiresLine = document.getElementById("rf-expires");
  const noEmailLine = document.getElementById("rf-no-email");
  const copyLinkButton = document.getElementById("rf-copy");

  // The whole visible state; render() draws it in the current language.
  const state = { name: documentKnown ? "idle" : "unavailable", fieldErrors: {}, retryMinutes: 0, downloadUrl: "", expiresAt: null, copy: "" };

  function clean(value) {
    return String(value == null ? "" : value).normalize("NFC").trim();
  }

  function fieldMessage(field, code) {
    if (field === "consent") return text("js_rf_consent_required");
    if (code === "required" || code === "too_short") return text("js_rf_field_required");
    if (code === "too_long") return text("js_rf_field_long");
    if (code === "invalid" && field === "email") return text("js_rf_field_email");
    return text("js_rf_invalid");
  }

  function formatDate(date) {
    try {
      return new Intl.DateTimeFormat(language(), { dateStyle: "long", timeStyle: "short" }).format(date);
    } catch (error) {
      return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
    }
  }

  function render() {
    const s = state.name;
    let status = "";
    if (s === "sending") status = text("js_rf_sending");
    else if (s === "invalid") status = text("js_rf_invalid");
    else if (s === "limited") status = text("js_rf_rate_limited").replace("{minutes}", String(state.retryMinutes));
    else if (s === "unavailable") status = text("js_rf_unavailable");
    statusLine.textContent = status;

    FIELDS.forEach((field) => {
      const code = state.fieldErrors[field];
      const slot = document.getElementById("rf-error-" + field);
      const input = form.elements[field];
      if (slot) slot.textContent = code ? fieldMessage(field, code) : "";
      if (input) {
        if (code) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      }
    });

    submitButton.disabled = s === "sending" || s === "success";
    form.hidden = s === "success";
    result.hidden = s !== "success";
    if (s === "success") {
      successLine.textContent = text("js_rf_success");
      link.textContent = state.downloadUrl;
      link.href = state.downloadUrl;
      expiresLine.textContent = text("js_rf_expires").replace("{date}", formatDate(state.expiresAt));
      noEmailLine.textContent = text("js_rf_no_email");
      copyLinkButton.textContent = state.copy === "copied" ? text("js_rf_copied") : state.copy === "failed" ? text("js_copy_failed") : text("js_rf_copy");
    }
  }

  function setState(name, extra) {
    state.name = name;
    state.fieldErrors = {};
    Object.assign(state, extra || {});
    render();
  }

  function readFields() {
    const values = {};
    ["name", "email", "company", "comment"].forEach((field) => {
      values[field] = clean(form.elements[field] ? form.elements[field].value : "");
    });
    values.consent = !!(form.elements.consent && form.elements.consent.checked);
    values.website = form.elements.website ? String(form.elements.website.value || "") : "";
    return values;
  }

  function checkFields(values) {
    const errors = {};
    Object.keys(LIMITS).forEach((field) => {
      const rule = LIMITS[field];
      const value = values[field];
      if (!value) {
        if (rule.required) errors[field] = "required";
      } else if (value.length < rule.min) errors[field] = "too_short";
      else if (value.length > rule.max) errors[field] = "too_long";
    });
    if (!errors.email && !EMAIL_SHAPE.test(values.email)) errors.email = "invalid";
    if (!values.consent) errors.consent = "required";
    return errors;
  }

  // Only an https link on the collector's host is shown; anything else is treated as a failure.
  function safeLink(value) {
    try {
      const url = new URL(String(value));
      return url.protocol === "https:" && url.hostname === LINK_HOST ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  async function handleResponse(response) {
    const body = await readJson(response);
    if (response.status === 201 && body) {
      const downloadUrl = safeLink(body.downloadUrl);
      const expiresAt = new Date(body.expiresAt);
      if (!downloadUrl || Number.isNaN(expiresAt.getTime())) return setState("unavailable");
      setState("success", { downloadUrl, expiresAt, copy: "" });
      try {
        if (window.umami && typeof window.umami.track === "function") window.umami.track("report-requested");
      } catch (error) {}
      return;
    }
    if (response.status === 422 && body && body.fields && typeof body.fields === "object") {
      const errors = {};
      FIELDS.forEach((field) => {
        if (typeof body.fields[field] === "string") errors[field] = body.fields[field];
      });
      // A refusal of a field the reader cannot change (site, consentVersion, lang) is ours.
      if (!Object.keys(errors).length) return setState("unavailable");
      state.name = "invalid";
      state.fieldErrors = errors;
      return render();
    }
    if (response.status === 429) {
      const seconds = body && Number(body.retryAfterSeconds);
      const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : 60;
      return setState("limited", { retryMinutes: minutes });
    }
    setState("unavailable");
  }

  form.setAttribute("novalidate", "");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.name === "sending" || state.name === "success") return;
    // A page without a valid data-document sends nothing, whatever the reader typed.
    if (!documentKnown) return setState("unavailable");
    const values = readFields();
    const errors = checkFields(values);
    if (Object.keys(errors).length) {
      state.name = "invalid";
      state.fieldErrors = errors;
      return render();
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(CONSENT_VERSION)) return setState("unavailable");

    const payload = {
      site: SITE_ID,
      form: FORM_ID,
      document: documentId,
      name: values.name,
      email: values.email,
      company: values.company,
      consent: true,
      consentVersion: CONSENT_VERSION,
      website: values.website
    };
    // lang is sent only when it is one of the ten codes (the collector refuses any other value).
    const lang = language();
    if (LANGUAGES.includes(lang)) payload.lang = lang;
    if (values.comment) payload.comment = values.comment;

    setState("sending");
    let response;
    try {
      const options = {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      };
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
        options.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      }
      response = await fetch(COLLECTOR_URL, options);
    } catch (error) {
      return setState("unavailable");
    }
    try {
      await handleResponse(response);
    } catch (error) {
      setState("unavailable");
    }
  });

  copyLinkButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.downloadUrl);
      state.copy = "copied";
    } catch (error) {
      state.copy = "failed";
    }
    render();
  });

  document.addEventListener("dp:language", render);
  render();
})();
