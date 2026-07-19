// Theme toggle (dark is the default; choice persists in localStorage)
(function () {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");

  toggle.addEventListener("click", function () {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("xensql-theme", next);
    } catch (e) {}
  });
})();

// Detect the visitor's OS: point the hero button at the right download
// and highlight the matching card in the download section.
(function () {
  const ua = navigator.userAgent;
  const os = /Mac|iPhone|iPad/i.test(ua) ? "macos" : /Linux/i.test(ua) && !/Android/i.test(ua) ? "linux" : /Win/i.test(ua) ? "windows" : null;
  if (!os) return;

  const labels = { windows: "Download for Windows", macos: "Download for macOS", linux: "Download for Linux" };
  const label = document.getElementById("hero-download-label");
  if (label) label.textContent = labels[os];

  const card = document.getElementById("dl-" + os);
  if (card) card.classList.add("dl-detected");
})();

// Screenshot lightbox
(function () {
  const lightbox = document.getElementById("lightbox");
  const img = lightbox.querySelector("img");
  const caption = lightbox.querySelector(".lightbox-caption");

  document.querySelectorAll(".gallery figure").forEach(function (fig) {
    fig.querySelector("img").addEventListener("click", function (e) {
      img.src = e.target.src;
      img.alt = e.target.alt;
      const cap = fig.querySelector("figcaption");
      caption.textContent = cap ? cap.textContent : "";
      lightbox.hidden = false;
      document.body.style.overflow = "hidden";
    });
  });

  function close() {
    lightbox.hidden = true;
    img.src = "";
    document.body.style.overflow = "";
  }

  lightbox.addEventListener("click", close);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !lightbox.hidden) close();
  });
})();
