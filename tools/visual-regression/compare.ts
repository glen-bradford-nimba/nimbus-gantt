/**
 * compare.ts — pairs up captured screenshots and runs pixelmatch on them.
 *
 * Inputs:  ./screenshots/<target>/<section>.png  (produced by capture.ts)
 * Outputs: ./diffs/<pair>/<section>.png          (diff visualisation)
 *          ./diffs/_report.json                  (report data consumed by report.ts)
 *
 * Thresholds (from V10 plan):
 *   diff % < 2  → pass
 *   2 ≤ diff % < 5 → warn
 *   diff % ≥ 5  → fail (process exits 1)
 */

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparisonPairs, getTarget } from './targets.ts';
import { sections } from './sections.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_ROOT = join(__dirname, 'screenshots');
const DIFF_ROOT = join(__dirname, 'diffs');

export type Verdict = 'pass' | 'warn' | 'fail' | 'skip';

export interface SectionComparison {
  sectionId: string;
  label: string;
  aPath: string;
  bPath: string;
  diffPath: string | null;
  widthA: number;
  heightA: number;
  widthB: number;
  heightB: number;
  totalPixels: number;
  mismatchedPixels: number;
  diffPercent: number;
  verdict: Verdict;
  note?: string;
}

export interface PairReport {
  pairName: string;
  a: string;
  b: string;
  sections: SectionComparison[];
  overall: Verdict;
}

export interface FullReport {
  generatedAt: string;
  pairs: PairReport[];
  overall: Verdict;
}

const PASS_MAX = 2;
const WARN_MAX = 5;

function classify(diffPct: number): Verdict {
  if (diffPct < PASS_MAX) return 'pass';
  if (diffPct < WARN_MAX) return 'warn';
  return 'fail';
}

function worst(a: Verdict, b: Verdict): Verdict {
  const order: Record<Verdict, number> = { pass: 0, skip: 1, warn: 2, fail: 3 };
  return order[a] >= order[b] ? a : b;
}

async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) await mkdir(path, { recursive: true });
}

async function readPng(path: string): Promise<PNG | null> {
  if (!existsSync(path)) return null;
  const buf = await readFile(path);
  try {
    return PNG.sync.read(buf);
  } catch {
    return null;
  }
}

/**
 * pixelmatch requires equal dimensions. When one screenshot is larger (e.g.,
 * Salesforce chrome adds pixels), we pad the smaller image with transparent
 * pixels so the comparison still runs — padding pixels count as mismatches,
 * which is the behaviour we want (they *are* differences).
 */
function padToSize(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  // Transparent fill.
  out.data.fill(0);
  PNG.bitblt(png, out, 0, 0, Math.min(png.width, width), Math.min(png.height, height), 0, 0);
  return out;
}

async function comparePair(pairName: string, aId: string, bId: string): Promise<PairReport> {
  const aTarget = getTarget(aId as never);
  const bTarget = getTarget(bId as never);
  if (!aTarget || !bTarget) throw new Error(`Unknown target in pair ${pairName}`);

  const pairDir = join(DIFF_ROOT, pairName);
  await ensureDir(pairDir);

  const pair: PairReport = {
    pairName,
    a: aTarget.label,
    b: bTarget.label,
    sections: [],
    overall: 'pass',
  };

  // Short-circuit if either target isn't enabled in this run.
  if (!aTarget.enabled || !bTarget.enabled) {
    pair.overall = 'skip';
    for (const section of sections) {
      pair.sections.push({
        sectionId: section.id,
        label: section.label,
        aPath: '',
        bPath: '',
        diffPath: null,
        widthA: 0,
        heightA: 0,
        widthB: 0,
        heightB: 0,
        totalPixels: 0,
        mismatchedPixels: 0,
        diffPercent: 0,
        verdict: 'skip',
        note: `Skipped — target "${!aTarget.enabled ? aId : bId}" not enabled. ${!aTarget.enabled ? aTarget.disabledReason ?? '' : bTarget.disabledReason ?? ''}`.trim(),
      });
    }
    return pair;
  }

  for (const section of sections) {
    const aPath = join(SCREENSHOT_ROOT, aId, `${section.id}.png`);
    const bPath = join(SCREENSHOT_ROOT, bId, `${section.id}.png`);
    const diffPath = join(pairDir, `${section.id}.png`);

    const base: Omit<SectionComparison, 'diffPath' | 'mismatchedPixels' | 'diffPercent' | 'verdict'> = {
      sectionId: section.id,
      label: section.label,
      aPath,
      bPath,
      widthA: 0,
      heightA: 0,
      widthB: 0,
      heightB: 0,
      totalPixels: 0,
    };

    const aPng = await readPng(aPath);
    const bPng = await readPng(bPath);

    if (!aPng || !bPng) {
      pair.sections.push({
        ...base,
        diffPath: null,
        mismatchedPixels: 0,
        diffPercent: 0,
        verdict: 'skip',
        note: !aPng && !bPng ? 'Both screenshots missing' : !aPng ? `${aId} screenshot missing` : `${bId} screenshot missing`,
      });
      continue;
    }

    const width = Math.max(aPng.width, bPng.width);
    const height = Math.max(aPng.height, bPng.height);
    const aPad = padToSize(aPng, width, height);
    const bPad = padToSize(bPng, width, height);
    const diff = new PNG({ width, height });

    const mismatched = pixelmatch(aPad.data, bPad.data, diff.data, width, height, {
      threshold: 0.1,
      includeAA: false,
    });
    const total = width * height;
    const pct = total === 0 ? 0 : (mismatched / total) * 100;

    await writeFile(diffPath, PNG.sync.write(diff));

    const verdict = classify(pct);
    pair.overall = worst(pair.overall, verdict);

    pair.sections.push({
      ...base,
      widthA: aPng.width,
      heightA: aPng.height,
      widthB: bPng.width,
      heightB: bPng.height,
      totalPixels: total,
      diffPath,
      mismatchedPixels: mismatched,
      diffPercent: Number(pct.toFixed(3)),
      verdict,
    });
  }

  return pair;
}

export async function compare(): Promise<FullReport> {
  await ensureDir(DIFF_ROOT);
  const report: FullReport = {
    generatedAt: new Date().toISOString(),
    pairs: [],
    overall: 'pass',
  };

  for (const pair of comparisonPairs) {
    console.log(`\n[compare] → ${pair.name}`);
    const result = await comparePair(pair.name, pair.a, pair.b);
    report.pairs.push(result);
    report.overall = worst(report.overall, result.overall);
    for (const s of result.sections) {
      const pctStr = s.totalPixels > 0 ? `${s.diffPercent.toFixed(2)}%` : '—';
      console.log(`  ${s.verdict.padEnd(5)} ${s.sectionId.padEnd(20)} ${pctStr.padStart(8)}${s.note ? `  (${s.note})` : ''}`);
    }
    console.log(`[compare] ← ${pair.name}: overall=${result.overall}`);
  }

  await writeFile(join(DIFF_ROOT, '_report.json'), JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('compare.ts')) {
  compare()
    .then((report) => {
      console.log(`\n[compare] overall verdict: ${report.overall}`);
      if (report.overall === 'fail') process.exit(1);
    })
    .catch((err) => {
      console.error('[compare] fatal:', err);
      process.exit(1);
    });
}
