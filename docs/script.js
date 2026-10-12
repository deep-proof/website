// Assembled at runtime so the address never appears in the page source.
const CONTACT_EMAIL = ["contact", ["deepproof", "ch"].join(".")].join(String.fromCharCode(64));
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Email links ---------- */
document.querySelectorAll("[data-mail]").forEach((link) => {
  const subject = link.dataset.mail;
  link.href = "mailto:" + CONTACT_EMAIL + (subject ? "?subject=" + subject : "");
});

/* ---------- Mobile navigation ---------- */
const menuToggle = document.querySelector("[data-menu-toggle]");
const menu = document.querySelector("[data-menu]");

if (menuToggle && menu) {
  const setMenu = (open) => {
    menuToggle.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("menu-open", open);
  };
  menuToggle.addEventListener("click", () => setMenu(menuToggle.getAttribute("aria-expanded") !== "true"));
  menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("menu-open")) {
      setMenu(false);
      menuToggle.focus();
    }
  });
}

/* ---------- Story animation (home page only) ---------- */
const scenes = [...document.querySelectorAll("[data-scene]")];
const sceneButtons = [...document.querySelectorAll("[data-scene-button]")];
const stage = document.querySelector("[data-story-stage]");
const storyLabel = document.querySelector("[data-story-label]");
const toggleButton = document.querySelector("[data-story-toggle]");
const startButton = document.querySelector("[data-story-start]");
const nextButton = document.querySelector("[data-story-next]");
const storyNames = ["Project setup", "Validated AI Review Skill", "Dossier added", "Structured review", "Decision memo"];

let activeScene = 0;
let isPlaying = !reduceMotion;
let storyTimer;

function showScene(index) {
  activeScene = (index + scenes.length) % scenes.length;
  scenes.forEach((scene, sceneIndex) => {
    const selected = sceneIndex === activeScene;
    scene.classList.toggle("is-active", selected);
    scene.setAttribute("aria-hidden", String(!selected));
  });
  sceneButtons.forEach((button, buttonIndex) => {
    const selected = buttonIndex === activeScene;
    button.classList.toggle("is-current", selected);
    button.setAttribute("aria-current", selected ? "step" : "false");
  });
  if (storyLabel) storyLabel.textContent = storyNames[activeScene];
}

function stopTimer() {
  window.clearInterval(storyTimer);
}

function startTimer() {
  stopTimer();
  if (!isPlaying || reduceMotion) return;
  storyTimer = window.setInterval(() => showScene(activeScene + 1), 5200);
}

function renderToggle() {
  if (!toggleButton) return;
  toggleButton.innerHTML = isPlaying ? 'Pause <span aria-hidden="true">Ⅱ</span>' : 'Play <span aria-hidden="true">▶</span>';
  toggleButton.setAttribute("aria-label", isPlaying ? "Pause story animation" : "Play story animation");
}

if (scenes.length) {
  toggleButton?.addEventListener("click", () => {
    isPlaying = !isPlaying;
    renderToggle();
    startTimer();
  });

  nextButton?.addEventListener("click", () => {
    showScene(activeScene + 1);
    startTimer();
  });

  sceneButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      showScene(index);
      startTimer();
    });
  });

  startButton?.addEventListener("click", () => {
    stage.closest(".story-shell").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    showScene(0);
    isPlaying = !reduceMotion;
    renderToggle();
    startTimer();
  });

  // Pause the story while it is off screen or the tab is hidden.
  if ("IntersectionObserver" in window && stage) {
    new IntersectionObserver(([entry]) => (entry.isIntersecting ? startTimer() : stopTimer())).observe(stage);
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? stopTimer() : startTimer()));

  renderToggle();
  showScene(0);
  startTimer();
}

/* ---------- Skill preview ---------- */
const skillPreviews = [
  {
    kind: "AI Review Skill file / instructions",
    footer: "Instruction set checked by the review owner",
    code: [
      '<span class="code-muted"># Revenue quality review</span>',
      "<span>Assess concentration across customers and</span>",
      "<span>channels. <b>Flag</b> any dependency above the</span>",
      "<span>approved threshold. Cite every conclusion.</span>",
      '<span class="code-muted"># Report uncertainty</span>',
      "<span>When sources disagree, show the conflict.</span>"
    ]
  },
  {
    kind: "AI Review Skill file / analysis logic",
    footer: "Repeatable checks linked to the review criteria",
    code: [
      '<span class="code-muted">// debt-service coverage</span>',
      "<span>const coverage = cashFlow / debtService;</span>",
      "<span>if (coverage &lt; threshold) <b>flagRisk</b>();</span>",
      '<span class="code-muted">// compare stated and modelled values</span>',
      "<span>traceToSource(coverage, sourcePage);</span>"
    ]
  },
  {
    kind: "AI Review Skill file / verification suite",
    footer: "Held-out cases must pass before a production review",
    code: [
      '<span class="code-muted">Scenario: conflicting evidence</span>',
      "<span>Given two sources with opposing claims</span>",
      "<span>Then the review <b>shows both</b> and asks</span>",
      "<span>for the missing confirmation.</span>",
      '<span class="code-muted">Expected: no unsupported conclusion</span>'
    ]
  },
  {
    kind: "AI Review Skill file / calibration record",
    footer: "Approved by your review owner · v1.4",
    code: [
      '<span class="code-muted">Calibration / commercial lending</span>',
      "<span>Thresholds adjusted to policy 2026.</span>",
      "<span>Terminology verified with credit team.</span>",
      "<span><b>Approved</b> for standard underwriting.</span>",
      '<span class="code-muted">Next review: 12 months</span>'
    ]
  }
];

const previewKind = document.querySelector("[data-preview-kind]");
const previewCode = document.querySelector("[data-preview-code]");
const previewFooter = document.querySelector("[data-preview-footer]");
const skillSteps = [...document.querySelectorAll("[data-skill]")];

skillSteps.forEach((step) => {
  step.addEventListener("click", () => {
    const preview = skillPreviews[Number(step.dataset.skill)];
    skillSteps.forEach((item) => {
      const selected = item === step;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    previewKind.textContent = preview.kind;
    previewCode.innerHTML = preview.code.join("");
    previewFooter.textContent = preview.footer;
  });
});

/* ---------- Contact dialog ---------- */
const contactDialog = document.querySelector("[data-contact-dialog]");
const contactForm = document.querySelector("[data-contact-form]");
const contactCloseButton = document.querySelector("[data-contact-close]");
const formFallback = document.querySelector("[data-form-fallback]");
const copyButton = document.querySelector("[data-copy-message]");
let draftedMessage = "";

if (contactDialog && contactForm) {
  document.querySelectorAll("[data-contact-open]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!contactDialog.open) contactDialog.showModal();
    });
  });

  contactCloseButton?.addEventListener("click", () => contactDialog.close());

  contactDialog.addEventListener("click", (event) => {
    if (event.target === contactDialog) contactDialog.close();
  });

  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const details = new FormData(contactForm);
    draftedMessage = [
      "Deep Proof project conversation",
      "",
      "Name: " + details.get("name"),
      "Work email: " + details.get("email"),
      "Company: " + (details.get("company") || "Not provided"),
      "Type of review: " + details.get("reviewType"),
      "",
      "Use case:",
      details.get("message")
    ].join("\n");
    window.location.href =
      "mailto:" + CONTACT_EMAIL +
      "?subject=" + encodeURIComponent("Deep Proof project conversation") +
      "&body=" + encodeURIComponent(draftedMessage);
    if (formFallback) formFallback.hidden = false;
  });

  copyButton?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(draftedMessage);
      copyButton.textContent = "Message copied";
    } catch {
      copyButton.textContent = "Copy failed: please select the text manually";
    }
  });
}
