// Column resizing for the skills table. Drag a grip in the header to resize
// that column; double click a grip to reset it. Widths persist per browser.
(function () {
  const LIMITS = {
    skill: { min: 96, max: 480 },
    verified: { min: 64, max: 240 },
    area: { min: 48, max: 176 },
  };
  const root = document.documentElement;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("colWidths")) || {}; } catch { saved = {}; }
  for (const k in saved) if (LIMITS[k]) root.style.setProperty("--col-" + k, saved[k] + "px");

  document.querySelectorAll(".grip").forEach((g) => {
    const col = g.dataset.col;
    if (!LIMITS[col]) return;
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = g.parentElement.getBoundingClientRect().width;
      const move = (ev) => {
        const w = Math.round(Math.min(LIMITS[col].max, Math.max(LIMITS[col].min, startW + ev.clientX - startX)));
        root.style.setProperty("--col-" + col, w + "px");
        saved[col] = w;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        localStorage.setItem("colWidths", JSON.stringify(saved));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    g.addEventListener("dblclick", () => {
      root.style.removeProperty("--col-" + col);
      delete saved[col];
      localStorage.setItem("colWidths", JSON.stringify(saved));
    });
  });
})();
