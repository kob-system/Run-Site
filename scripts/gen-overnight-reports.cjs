const fs = require('fs');
const path = require('path');

const OUT = process.argv[2];
const REPO = path.resolve(__dirname, '..');
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'));
let d = w.result;
if (typeof d === 'string') d = JSON.parse(d);

const DATE = '2026-06-17';
const esc = s => (s == null ? '' : String(s));
const list = (arr) => (arr && arr.length ? arr.map(x => `  - ${esc(x)}`).join('\n') : '  - (none)');

// ---------- COMPETITORS ----------
let comp = `# Run-Site — Competitor Intel\n_Overnight multi-agent research, ${DATE}. ${d.competitors.length} competitors profiled from real review/forum sources._\n\n`;
comp += `## Positioning brief (synthesized)\n\n${esc(d.positioning)}\n\n---\n\n## Competitor profiles\n\n`;
for (const c of d.competitors) {
  comp += `### ${esc(c.name)}\n`;
  comp += `**Who it's for:** ${esc(c.who_for)}\n\n`;
  comp += `**Pricing:** ${esc(c.pricing)}\n\n`;
  comp += `**Strengths:**\n${list(c.strengths)}\n\n`;
  comp += `**Weaknesses (real complaints):**\n${list(c.weaknesses)}\n\n`;
  comp += `**↳ Run-Site's wedge:** ${esc(c.gap_for_runsite)}\n\n---\n\n`;
}
fs.writeFileSync(path.join(REPO, 'COMPETITORS-0617.md'), comp);

// ---------- LAUNCH RISKS ----------
const order = { yes: 0, partial: 1, unclear: 2, no: 3 };
const risks = [...d.confirmedRisks].sort((a, b) => (order[a.present_in_runsite] ?? 9) - (order[b.present_in_runsite] ?? 9));
let rk = `# Run-Site — Launch Risks (pitfalls cross-referenced to YOUR code)\n_Overnight research, ${DATE}. ${d.pitfalls.length} real-world launch pitfalls researched; ${d.confirmedRisks.length} checked against the Run-Site codebase._\n\n`;
const present = risks.filter(r => r.present_in_runsite === 'yes' || r.present_in_runsite === 'partial');
rk += `## ⚠️ Present or partial in Run-Site — fix these (${present.length})\n\n`;
for (const r of present) {
  rk += `### [${r.present_in_runsite.toUpperCase()}] ${esc(r.title)}\n`;
  rk += `- **Evidence:** ${esc(r.evidence)}\n`;
  rk += `- **Fix:** ${esc(r.fix)}\n\n`;
}
rk += `\n## ✅ Checked & clear / not applicable\n\n`;
for (const r of risks.filter(r => r.present_in_runsite === 'no' || r.present_in_runsite === 'unclear')) {
  rk += `- **[${esc(r.present_in_runsite)}] ${esc(r.title)}** — ${esc(r.evidence)}\n`;
}
rk += `\n---\n\n## All researched pitfalls (reference library)\n\n`;
const byRel = { high: [], medium: [], low: [] };
for (const p of d.pitfalls) (byRel[p.runsite_relevance] || byRel.low).push(p);
for (const rel of ['high', 'medium', 'low']) {
  rk += `### Relevance: ${rel} (${byRel[rel].length})\n\n`;
  for (const p of byRel[rel]) {
    rk += `**${esc(p.title)}**\n`;
    rk += `- What happened: ${esc(p.what_happened)}\n`;
    rk += `- How it bit them: ${esc(p.how_it_bit_them)}\n`;
    rk += `- How to avoid: ${esc(p.how_to_avoid)}\n\n`;
  }
}
fs.writeFileSync(path.join(REPO, 'LAUNCH-RISKS-0617.md'), rk);

// ---------- DESIGN AUDIT ----------
const sevOrder = { high: 0, medium: 1, low: 2 };
const findings = [...d.confirmedFindings].sort((a, b) =>
  (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));
let da = `# Run-Site — Front-End Design & UX Audit\n_Overnight per-screen audit, ${DATE}. ${d.confirmedFindings.length} findings that survived adversarial verification against the current code._\n\n`;
const screens = [...new Set(findings.map(f => f.screen))];
da += `## Summary\n\n| Screen | High | Med | Low | Safe-to-auto-fix |\n|---|---|---|---|---|\n`;
for (const s of screens) {
  const fs2 = findings.filter(f => f.screen === s);
  da += `| ${s} | ${fs2.filter(f => f.severity === 'high').length} | ${fs2.filter(f => f.severity === 'medium').length} | ${fs2.filter(f => f.severity === 'low').length} | ${fs2.filter(f => f.safe).length} |\n`;
}
da += `\n---\n\n`;
for (const s of screens) {
  da += `## ${s}\n\n`;
  for (const f of findings.filter(f => f.screen === s)) {
    da += `### [${f.severity.toUpperCase()} · ${f.effort} · ${f.safe ? 'SAFE' : 'needs-care'}] ${esc(f.title)}\n`;
    da += `- **Where:** \`${esc(f.file_line)}\`\n`;
    da += `- **Problem:** ${esc(f.problem)}\n`;
    da += `- **Fix:** ${esc(f.fix)}\n`;
    if (f.verdict && f.verdict.corrected_file_line) da += `- **Verified at:** \`${esc(f.verdict.corrected_file_line)}\`\n`;
    da += `\n`;
  }
}
fs.writeFileSync(path.join(REPO, 'DESIGN-AUDIT-0617.md'), da);

// ---------- COMPACT FINDINGS TABLE (stdout) ----------
console.log('Reports written: COMPETITORS-0617.md, LAUNCH-RISKS-0617.md, DESIGN-AUDIT-0617.md\n');
console.log('=== CONFIRMED DESIGN FINDINGS (sorted sev) ===');
findings.forEach((f, i) => {
  console.log(`${String(i).padStart(2)} | ${f.severity.padEnd(6)} | ${f.effort} | ${f.safe ? 'SAFE' : 'care'} | ${esc(f.screen).padEnd(14)} | ${esc(f.title).slice(0, 60)} | ${esc(f.file_line)}`);
});
console.log(`\nSAFE high/med count: ${findings.filter(f => f.safe && f.severity !== 'low').length}`);
