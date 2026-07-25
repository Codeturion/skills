// Generates site/banner.svg: the README banner, a snapshot of the verified
// skill table in the site's default (rider) theme. Reads the same sources as
// build-skills-js.mjs so the banner always matches the site.
// Run from the repo root: node scripts/build-banner.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const verified = [];
let planned = 0;
for (const dir of readdirSync("skills", { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const p = `skills/${dir.name}/site.json`;
  if (!existsSync(p)) continue;
  const e = JSON.parse(readFileSync(p, "utf8"));
  if (e.status === "verified") verified.push(e);
  else planned++;
}
planned += JSON.parse(readFileSync("site/roadmap.json", "utf8")).length;
verified.sort((a, b) => a.slug.localeCompare(b.slug));

// palette = the site's default rider theme in site/style.css (:root)
const C = {
  bg: "#1E1F22", row: "#26282B", border: "#393B40", text: "#BCBEC4",
  soft: "#9DA0A8", accent: "#CF8E6D", green: "#6AAB73", link: "#548AF7",
};
const FONT = "SF Mono,Menlo,Consolas,monospace";
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const W = 1200, ROW = 44, HEAD = 118, FOOT = 64;
const H = HEAD + verified.length * ROW + FOOT;

let rows = "";
verified.forEach((s, i) => {
  const y = HEAD + i * ROW;
  rows += `
  <rect x="24" y="${y}" width="${W - 48}" height="${ROW}" fill="${i % 2 ? C.bg : C.row}"/>
  <text x="48" y="${y + 28}" font-family="${FONT}" font-size="17" fill="${C.accent}">${esc(s.slug)}</text>
  <text x="330" y="${y + 28}" font-family="${FONT}" font-size="15" fill="${C.soft}">${esc(s.blurb.slice(0, 74))}</text>
  <text x="${W - 190}" y="${y + 28}" font-family="${FONT}" font-size="14" fill="${C.green}">✓ ${esc(s.verified)}</text>`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verified Unity skills: browse on skills.fuatcankoseoglu.com">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${C.border}"/>
  <circle cx="40" cy="36" r="7" fill="#ff5f56"/><circle cx="64" cy="36" r="7" fill="#ffbd2e"/><circle cx="88" cy="36" r="7" fill="#27c93f"/>
  <text x="${W / 2}" y="42" text-anchor="middle" font-family="${FONT}" font-size="16" fill="${C.soft}">skills.fuatcankoseoglu.com</text>
  <text x="48" y="90" font-family="${FONT}" font-size="26" font-weight="bold" fill="${C.text}">Verified Unity skills</text>
  <text x="${W - 48}" y="90" text-anchor="end" font-family="${FONT}" font-size="15" fill="${C.soft}">${verified.length} verified · ${planned} on the roadmap</text>
  ${rows}
  <text x="${W / 2}" y="${H - 26}" text-anchor="middle" font-family="${FONT}" font-size="15" fill="${C.link}">browse cards, verification records and install commands on the site →</text>
</svg>
`;
writeFileSync("site/banner.svg", svg);
console.log(`site/banner.svg: ${verified.length} verified rows, ${planned} planned`);
