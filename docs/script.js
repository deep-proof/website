const scenes = [...document.querySelectorAll("[data-scene]")];
const sceneButtons = [...document.querySelectorAll("[data-scene-button]")];
const stage = document.querySelector("[data-story-stage]");
const storyLabel = document.querySelector("[data-story-label]");
const toggleButton = document.querySelector("[data-story-toggle]");
const startButton = document.querySelector("[data-story-start]");
const nextButton = document.querySelector("[data-story-next]");
const storyNames = ["Project setup", "Validated Skill", "Dossier added", "Structured review", "Decision memo"];

let activeScene = 0;
let isPlaying = true;
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
  storyLabel.textContent = storyNames[activeScene];
}

function stopTimer() {
  window.clearInterval(storyTimer);
}

function startTimer() {
  stopTimer();
  if (!isPlaying || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  storyTimer = window.setInterval(() => showScene(activeScene + 1), 5200);
}

toggleButton.addEventListener("click", () => {
  isPlaying = !isPlaying;
  toggleButton.innerHTML = isPlaying ? "Pause <span>Ⅱ</span>" : "Play <span>▶</span>";
  toggleButton.setAttribute("aria-label", isPlaying ? "Pause story animation" : "Play story animation");
  startTimer();
});

nextButton.addEventListener("click", () => {
  showScene(activeScene + 1);
  startTimer();
});

sceneButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    showScene(index);
    startTimer();
  });
});

startButton.addEventListener("click", () => {
  stage.closest(".story-shell").scrollIntoView({ behavior: "smooth", block: "center" });
  showScene(0);
  isPlaying = true;
  toggleButton.innerHTML = "Pause <span>Ⅱ</span>";
  startTimer();
});

const skillPreviews = [
  {
    kind: "Skill file / instructions",
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
    kind: "Skill file / analysis logic",
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
    kind: "Skill file / verification suite",
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
    kind: "Skill file / calibration record",
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

document.querySelectorAll("[data-skill]").forEach((step) => {
  step.addEventListener("click", () => {
    const selected = Number(step.dataset.skill);
    document.querySelectorAll("[data-skill]").forEach((item) => item.classList.toggle("is-selected", item === step));
    const preview = skillPreviews[selected];
    previewKind.textContent = preview.kind;
    previewCode.innerHTML = preview.code.join("");
    previewFooter.textContent = preview.footer;
  });
});

const contactDialog = document.querySelector("[data-contact-dialog]");
const contactForm = document.querySelector("[data-contact-form]");
const contactCloseButton = document.querySelector("[data-contact-close]");

function openContactDialog() {
  if (!contactDialog.open) contactDialog.showModal();
}

document.querySelectorAll("[data-contact-open]").forEach((button) => {
  button.addEventListener("click", openContactDialog);
});

contactCloseButton.addEventListener("click", () => contactDialog.close());

contactDialog.addEventListener("click", (event) => {
  if (event.target === contactDialog) contactDialog.close();
});

contactForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const details = new FormData(contactForm);
  const message = [
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
  window.location.href = "mailto:contact@deepseek.ch?subject=" + encodeURIComponent("Deep Proof project conversation") + "&body=" + encodeURIComponent(message);
});

showScene(0);
startTimer();
