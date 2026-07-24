const state = { query: "", area: "all", status: "all", open: null, copied: null };

function installText(s) {
  return "npx skills add Codeturion/skills --skill " + s.slug + "\n# or as a Claude Code plugin:\n/plugin marketplace add Codeturion/skills\n/plugin install " + s.slug + "@skills";
}
function promptText(s) {
  return "Install the " + s.slug + " agent skill by running: npx skills add Codeturion/skills --skill " + s.slug + ". Then read its SKILL.md and let me know when it is finished.";
}
function copyText(key, text) {
  navigator.clipboard.writeText(text).then(() => {
    state.copied = key;
    render();
    setTimeout(() => { state.copied = null; render(); }, 1400);
  }).catch(() => {});
}
function esc(t) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function visible() {
  const q = state.query.trim().toLowerCase();
  return SKILLS
    .filter(s => state.area === "all" || s.area === state.area)
    .filter(s => state.status === "all" || s.status === state.status)
    .filter(s => !q || (s.name + " " + s.blurb + " " + s.detail + " " + s.sections + " " + s.area).toLowerCase().includes(q))
    .sort((a, b) => (RANK[a.status] - RANK[b.status]) || b.verified.localeCompare(a.verified));
}

function render() {
  const chips = (list, cur, host, set) => {
    host.innerHTML = "";
    for (const v of list) {
      const b = document.createElement("button");
      b.className = "chip" + (cur === v ? " on" : "");
      b.textContent = v;
      b.onclick = () => { set(v); state.open = null; render(); };
      host.appendChild(b);
    }
  };
  chips(AREAS, state.area, document.getElementById("area-chips"), v => state.area = v);
  chips(STATUSES, state.status, document.getElementById("status-chips"), v => state.status = v);

  const list = visible();
  const host = document.getElementById("rows");
  host.innerHTML = "";
  for (const s of list) {
    const isOpen = state.open === s.id;
    const avail = s.status === "verified";
    const done = state.copied === s.id;
    const promptDone = state.copied === s.id + "-p";
    const btnLabel = !avail ? "planned" : (done ? "copied ✓" : "copy install");
    const promptLabel = promptDone ? "copied ✓" : "copy prompt";

    const row = document.createElement("div");
    row.className = "row";

    const head = document.createElement("div");
    head.className = "row-head" + (isOpen ? " open" : "");
    head.innerHTML =
      '<span class="cell-name"><span class="caret">' + (isOpen ? "▾" : "▸") + '</span>' +
      '<span class="sname' + (avail ? " avail" : "") + '">' + esc(s.name) + '</span></span>' +
      '<span class="blurb">' + esc(s.blurb) + '</span>' +
      '<span class="verified' + (avail ? ' has-date' : '') + '">' + esc(s.verified) + '</span>' +
      '<span class="area">' + esc(s.area) + '</span>' +
      '<span class="cell-act">' +
      (avail ? '<button class="btn-copy prompt' + (promptDone ? ' done' : '') + '">' + promptLabel + '</button>' : '') +
      '<button class="btn-copy' + (done ? " done" : "") + '"' + (avail ? "" : " disabled") + '>' + btnLabel + '</button></span>';
    head.onclick = () => {
      state.open = isOpen ? null : s.id;
      history.replaceState(null, "", isOpen ? location.pathname + location.search : "#" + s.slug);
      render();
    };
    head.querySelector(".btn-copy:not(.prompt)").onclick = (e) => { e.stopPropagation(); if (avail) copyText(s.id, installText(s)); };
    const rowPrompt = head.querySelector(".btn-copy.prompt");
    if (rowPrompt) rowPrompt.onclick = (e) => { e.stopPropagation(); copyText(s.id + "-p", promptText(s)); };
    row.appendChild(head);

    if (isOpen) {
      const d = document.createElement("div");
      d.className = "detail";
      d.innerHTML =
        '<div><p>' + esc(s.detail) + '</p>' +
        (avail ? '<pre>' + esc(installText(s)) + '</pre>' : '') +
        '<div class="detail-actions">' +
        (avail
          ? '<button class="btn-big' + (done ? ' done' : '') + '">' + btnLabel + '</button>' +
            '<button class="btn-big prompt' + (promptDone ? ' done' : '') + '">' + (promptDone ? "copied ✓" : "copy prompt") + '</button>'
          : '') +
        '<a class="src-link" href="' + s.repo + '" rel="noopener">source ↗</a></div></div>' +
        '<div class="meta">' +
        '<div class="mobile-only"><div class="k">verified</div><span class="v">' + esc(s.verified) + '</span></div>' +
        '<div class="mobile-only"><div class="k">area</div><span class="v">' + esc(s.area) + '</span></div>' +
        '<div><div class="k">sections</div><span class="v">' + esc(s.sections) + '</span></div>' +
        '<div><div class="k">requires</div><span class="v">' + esc(s.requires) + '</span></div>' +
        '<div><div class="k">notes</div><span class="v">' + esc(s.notes) + '</span></div></div>';
      if (avail) {
        d.querySelector(".btn-big").onclick = () => copyText(s.id, installText(s));
        d.querySelector(".btn-big.prompt").onclick = () => copyText(s.id + "-p", promptText(s));
      }
      row.appendChild(d);
    }
    host.appendChild(row);
  }

  const pub = SKILLS.filter(s => s.status === "verified").length;
  document.getElementById("count").textContent = list.length + " of " + SKILLS.length + " skills · " + pub + " published";
  document.getElementById("copy-all").textContent = state.copied === "__all" ? "copied ✓" : "copy all verified";
}

document.getElementById("search").addEventListener("input", (e) => {
  state.query = e.target.value; state.open = null; render();
});
document.getElementById("copy-all").addEventListener("click", () => {
  copyText("__all", SKILLS.filter(s => s.status === "verified").map(installText).join("\n"));
});
window.addEventListener("keydown", (e) => {
  const search = document.getElementById("search");
  if (e.key === "/" && document.activeElement !== search) { e.preventDefault(); search.focus(); }
  if (e.key === "Escape") { state.query = ""; search.value = ""; state.open = null; render(); }
  if (e.key === "Enter" && state.open && document.activeElement === document.body) {
    const s = SKILLS.find(x => x.id === state.open);
    if (s && s.status === "verified") copyText(s.id, installText(s));
  }
});

function openFromHash() {
  const slug = decodeURIComponent(location.hash.slice(1)).toLowerCase().trim();
  const s = slug && (
    SKILLS.find(x => x.slug === slug) ||
    SKILLS.find(x => x.slug.startsWith(slug) || slug.startsWith(x.slug)) ||
    SKILLS.find(x => x.slug.includes(slug))
  );
  if (!s) { render(); return; }
  state.query = ""; state.area = "all"; state.status = "all"; state.open = s.id;
  document.getElementById("search").value = "";
  render();
  const head = document.querySelector(".row-head.open");
  if (head) head.scrollIntoView({ block: "center" });
}
window.addEventListener("hashchange", openFromHash);
openFromHash();

fetch("https://api.github.com/repos/Codeturion/skills")
  .then(r => r.ok ? r.json() : null)
  .then(d => {
    if (!d) return;
    document.getElementById("gh-link").textContent =
      "github ★ " + d.stargazers_count + " ⑂ " + d.forks_count;
  })
  .catch(() => {});

const themePick = document.getElementById("theme-pick");
themePick.value = document.documentElement.dataset.theme || "rider";
themePick.addEventListener("change", () => {
  document.documentElement.dataset.theme = themePick.value;
  localStorage.setItem("theme", themePick.value);
});
