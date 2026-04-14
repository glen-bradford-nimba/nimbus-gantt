/**
 * report.ts — render ./diffs/_report.json as a self-contained HTML report.
 *
 * Output: ./reports/visual-regression-report.html
 *
 * Design:
 *   - No external deps, all CSS inline, all images referenced via relative paths
 *     so the report lives next to the screenshots/diffs.
 *   - Every image is wrapped in <a target="_blank"> for click-to-zoom.
 *   - Per-pair verdict table with color-coded badges.
 *   - Summary header includes overall verdict and counts.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullReport, PairReport, SectionComparison, Verdict } from './compare.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIFF_ROOT = join(__dirname, 'diffs');
const REPORTS_ROOT = join(__dirname, 'reports');
const REPORT_PATH = join(REPORTS_ROOT, 'visual-regression-report.html');

const BADGE_COLORS: Record<Verdict, string> = {
  pass: '#10b981',
  warn: '#f59e0b',
  fail: '#ef4444',
  skip: '#94a3b8',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rel(fromHtml: string, target: string): string {
  if (!target) return '';
  return relative(dirname(fromHtml), target).replace(/\\/g, '/');
}

function badge(v: Verdict): string {
  return `<span class="badge" style="background:${BADGE_COLORS[v]}">${v.toUpperCase()}</span>`;
}

function renderSectionRow(section: SectionComparison, reportPath: string): string {
  const aRel = rel(reportPath, section.aPath);
  const bRel = rel(reportPath, section.bPath);
  const diffRel = section.diffPath ? rel(reportPath, section.diffPath) : '';

  const imgCell = (path: string, alt: string): string => {
    if (!path || !existsSync(join(dirname(reportPath), path))) {
      return `<td class="img-cell missing">missing</td>`;
    }
    return `<td class="img-cell"><a href="${escapeHtml(path)}" target="_blank"><img src="${escapeHtml(path)}" alt="${escapeHtml(alt)}" loading="lazy"/></a></td>`;
  };

  const pctText = section.totalPixels > 0 ? `${section.diffPercent.toFixed(2)}%` : '—';
  const noteText = section.note ? `<div class="note">${escapeHtml(section.note)}</div>` : '';

  return `
    <tr>
      <td class="section-name">
        <div class="section-id">${escapeHtml(section.sectionId)}</div>
        <div class="section-label">${escapeHtml(section.label)}</div>
        ${noteText}
      </td>
      ${imgCell(aRel, `${section.sectionId} A`)}
      ${imgCell(bRel, `${section.sectionId} B`)}
      ${imgCell(diffRel, `${section.sectionId} diff`)}
      <td class="pct-cell">${escapeHtml(pctText)}</td>
      <td class="verdict-cell">${badge(section.verdict)}</td>
    </tr>`;
}

function renderPair(pair: PairReport, reportPath: string): string {
  const rows = pair.sections.map((s) => renderSectionRow(s, reportPath)).join('');
  return `
    <section class="pair">
      <header class="pair-header">
        <h2>${escapeHtml(pair.pairName)} ${badge(pair.overall)}</h2>
        <div class="pair-meta">
          <div><strong>A:</strong> ${escapeHtml(pair.a)}</div>
          <div><strong>B:</strong> ${escapeHtml(pair.b)}</div>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th class="section-name">Section</th>
            <th>A</th>
            <th>B</th>
            <th>Diff</th>
            <th>Diff %</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function summaryStats(report: FullReport): { pass: number; warn: number; fail: number; skip: number } {
  const s = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const pair of report.pairs) {
    for (const sec of pair.sections) s[sec.verdict]++;
  }
  return s;
}

export async function renderReport(): Promise<string> {
  if (!existsSync(REPORTS_ROOT)) await mkdir(REPORTS_ROOT, { recursive: true });
  const jsonPath = join(DIFF_ROOT, '_report.json');
  if (!existsSync(jsonPath)) {
    throw new Error(`No report data at ${jsonPath}. Run \`npm run compare\` first.`);
  }
  const report: FullReport = JSON.parse(await readFile(jsonPath, 'utf-8'));
  const stats = summaryStats(report);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>nimbus-gantt visual regression — ${escapeHtml(report.generatedAt)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; background: #f8fafc; color: #0f172a; }
  header.top { padding: 24px 32px; background: #0f172a; color: #f8fafc; }
  header.top h1 { margin: 0 0 8px; font-size: 20px; font-weight: 700; }
  header.top .meta { font-size: 13px; color: #cbd5e1; }
  .summary { display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
  .summary .stat { background: #1e293b; padding: 8px 14px; border-radius: 8px; font-size: 13px; }
  .summary .stat strong { font-size: 16px; margin-right: 6px; }
  main { padding: 24px 32px; max-width: 1600px; margin: 0 auto; }
  section.pair { background: white; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 32px; overflow: hidden; }
  .pair-header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; background: #f1f5f9; }
  .pair-header h2 { margin: 0 0 6px; font-size: 16px; display: flex; align-items: center; gap: 10px; }
  .pair-meta { font-size: 12px; color: #475569; display: flex; gap: 18px; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { text-align: left; padding: 10px 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; border-bottom: 1px solid #e2e8f0; background: #fafbfc; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  .section-name { width: 220px; }
  .section-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #0f172a; font-weight: 600; }
  .section-label { font-size: 12px; color: #64748b; margin-top: 2px; }
  .note { font-size: 11px; color: #b45309; background: #fef3c7; padding: 4px 6px; border-radius: 4px; margin-top: 6px; }
  .img-cell { width: 28%; }
  .img-cell img { max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 6px; background: white; display: block; }
  .img-cell.missing { color: #94a3b8; font-style: italic; font-size: 12px; }
  .pct-cell { width: 80px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; text-align: right; }
  .verdict-cell { width: 80px; text-align: center; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; color: white; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; }
  a { text-decoration: none; }
  a:hover img { box-shadow: 0 0 0 2px #3b82f6; }
  footer { padding: 16px 32px; font-size: 12px; color: #64748b; }
</style>
</head>
<body>
  <header class="top">
    <h1>nimbus-gantt visual regression report ${badge(report.overall)}</h1>
    <div class="meta">Generated at ${escapeHtml(report.generatedAt)} — thresholds: pass &lt; 2%, warn &lt; 5%, fail ≥ 5%</div>
    <div class="summary">
      <div class="stat" style="border-left: 4px solid ${BADGE_COLORS.pass}"><strong>${stats.pass}</strong>pass</div>
      <div class="stat" style="border-left: 4px solid ${BADGE_COLORS.warn}"><strong>${stats.warn}</strong>warn</div>
      <div class="stat" style="border-left: 4px solid ${BADGE_COLORS.fail}"><strong>${stats.fail}</strong>fail</div>
      <div class="stat" style="border-left: 4px solid ${BADGE_COLORS.skip}"><strong>${stats.skip}</strong>skip</div>
    </div>
  </header>
  <main>
    ${report.pairs.map((p) => renderPair(p, REPORT_PATH)).join('\n')}
  </main>
  <footer>
    Click any image to open full-size in a new tab. Diffs are the third column; red pixels indicate mismatches.
  </footer>
</body>
</html>`;

  await writeFile(REPORT_PATH, html, 'utf-8');
  return REPORT_PATH;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('report.ts')) {
  renderReport()
    .then((path) => console.log(`\n[report] wrote ${path}`))
    .catch((err) => {
      console.error('[report] fatal:', err);
      process.exit(1);
    });
}
