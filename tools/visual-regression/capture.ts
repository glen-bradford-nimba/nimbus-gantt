/**
 * capture.ts — drives Playwright to screenshot every (target × section) pair.
 *
 * Outputs:
 *   ./screenshots/<target-id>/<section-id>.png
 *   ./screenshots/<target-id>/_meta.json   (which selector matched per section)
 *
 * Exits non-zero on hard navigation failures so CI can detect a broken dev
 * server. Missing sections are logged but do NOT fail the run — we record them
 * and let compare.ts mark the pair as "skipped" in the report.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enabledTargets, type Target } from './targets.ts';
import { sections, type Section } from './sections.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_ROOT = join(__dirname, 'screenshots');

interface SectionResult {
  sectionId: string;
  matchedSelector: string | null;
  captured: boolean;
  error?: string;
}

interface TargetResult {
  targetId: Target['id'];
  url: string;
  navigationOk: boolean;
  error?: string;
  sections: SectionResult[];
}

async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) {
    await mkdir(path, { recursive: true });
  }
}

async function captureTarget(browser: Browser, target: Target): Promise<TargetResult> {
  const outDir = join(SCREENSHOT_ROOT, target.id);
  await ensureDir(outDir);

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const result: TargetResult = {
    targetId: target.id,
    url: target.url,
    navigationOk: false,
    sections: [],
  };

  try {
    // Salesforce frontdoor: visit the one-shot URL first to establish session cookies.
    if (target.preAuthUrl && target.preAuthUrl !== target.url) {
      try {
        await page.goto(target.preAuthUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (err) {
        // Non-fatal: sometimes frontdoor redirects aggressively. Try the real URL next.
        console.warn(`[${target.id}] preAuth navigation warning:`, (err as Error).message);
      }
    }

    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait for readySelector — any of its comma-separated options will do.
    try {
      await page.waitForSelector(target.readySelector, { timeout: 20_000, state: 'visible' });
    } catch (err) {
      result.error = `readySelector "${target.readySelector}" never appeared: ${(err as Error).message}`;
      // Still attempt section captures — the page may have partially rendered.
    }

    await page.waitForTimeout(target.settleMs);
    result.navigationOk = true;

    for (const section of sections) {
      result.sections.push(await captureSection(page, section, outDir));
    }
  } catch (err) {
    result.error = (err as Error).message;
  } finally {
    await context.close();
  }

  // Write per-target meta file so compare.ts knows which selectors matched.
  await writeFile(join(outDir, '_meta.json'), JSON.stringify(result, null, 2));
  return result;
}

async function captureSection(page: Page, section: Section, outDir: string): Promise<SectionResult> {
  const pngPath = join(outDir, `${section.id}.png`);

  if (section.fullPage) {
    try {
      await page.screenshot({ path: pngPath, fullPage: false }); // viewport-sized
      return { sectionId: section.id, matchedSelector: '<viewport>', captured: true };
    } catch (err) {
      return { sectionId: section.id, matchedSelector: null, captured: false, error: (err as Error).message };
    }
  }

  for (const selector of section.selectors) {
    const handle = await page.$(selector);
    if (!handle) continue;
    try {
      // `scale: 'css'` keeps 1:1 with CSS pixels — essential for stable diffs.
      await handle.screenshot({ path: pngPath, scale: 'css' });
      return { sectionId: section.id, matchedSelector: selector, captured: true };
    } catch (err) {
      // Element may be zero-sized (common for hidden panels). Try next selector.
      console.warn(`[section ${section.id}] selector ${selector} screenshot failed: ${(err as Error).message}`);
      continue;
    }
  }

  return {
    sectionId: section.id,
    matchedSelector: null,
    captured: false,
    error: `No selector matched: ${section.selectors.join(' | ')}`,
  };
}

export async function capture(): Promise<TargetResult[]> {
  await ensureDir(SCREENSHOT_ROOT);

  const active = enabledTargets();
  if (active.length === 0) {
    throw new Error(
      'No enabled targets. Check targets.ts and/or set BASE_URL / SF_SESSION_URL env vars.',
    );
  }

  console.log(`\n[capture] Starting with ${active.length} target(s):`);
  for (const t of active) console.log(`  - ${t.id}: ${t.url}`);

  const browser = await chromium.launch({ headless: true });
  const results: TargetResult[] = [];

  try {
    for (const t of active) {
      console.log(`\n[capture] → ${t.id} (${t.label})`);
      const r = await captureTarget(browser, t);
      const okCount = r.sections.filter((s) => s.captured).length;
      const missCount = r.sections.length - okCount;
      console.log(
        `[capture] ← ${t.id}: nav=${r.navigationOk ? 'ok' : 'FAIL'}, sections=${okCount}/${r.sections.length} captured, ${missCount} missing${r.error ? `, err="${r.error}"` : ''}`,
      );
      results.push(r);
    }
  } finally {
    await browser.close();
  }

  // Write global summary.
  await writeFile(
    join(SCREENSHOT_ROOT, '_summary.json'),
    JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2),
  );
  return results;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('capture.ts')) {
  capture()
    .then((results) => {
      const hardFails = results.filter((r) => !r.navigationOk);
      if (hardFails.length > 0) {
        console.error('\n[capture] HARD FAILURES (navigation broke):');
        for (const r of hardFails) console.error(`  - ${r.targetId}: ${r.error}`);
        console.error(
          '\nIs the dev server running at the configured BASE_URL (default http://localhost:3000)?',
        );
        console.error('From cloudnimbusllc.com repo root: `npm run dev` (or `pnpm dev`).');
        process.exit(1);
      }
      console.log('\n[capture] done.');
    })
    .catch((err) => {
      console.error('[capture] fatal:', err);
      process.exit(1);
    });
}
