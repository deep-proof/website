// Shared Umami configuration for every page.
(function () {
  if (document.getElementById("umami-tracking")) return;

  const script = document.createElement("script");
  script.id = "umami-tracking";
  script.defer = true;
  script.src = "https://bizanso.com/base-agent-additional-server/umamiAgent/3000/script.js";
  script.setAttribute("data-website-id", "f58e98e6-33a4-479f-b66b-d3b8175fef28");
  document.head.appendChild(script);
})();
