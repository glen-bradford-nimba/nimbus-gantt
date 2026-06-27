/**
 * verify-embedded.mjs — headless reproduction + verification of the
 * embedded+batchMode audit-pass commit path against the BUILT bundle.
 *
 * Run: node packages/app/dev/verify-embedded.mjs
 * Requires: playwright chromium (npx playwright install chromium).
 *
 * Exercises the exact path that three prod bugs hid in: stage an edit (= drag)
 * → "Review & commit" pill → click → review modal → confirm → onAuditSubmit →
 * buffer clears. Prints PASS/FAIL per step and exits non-zero on any failure.
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const harness = pathToFileURL(join(here, 'embedded-harness.html')).href;

let failures = 0;
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.text().includes('onAuditSubmit') || m.text().includes('Error')) console.log('  [page] ' + m.text()); });
page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));

await page.goto(harness);
await page.waitForFunction(() => !!window.__handle, null, { timeout: 10000 });

// 1. Stage an edit (= a drag). Pill should appear.
await page.click('#stage');
const pill = await page.waitForSelector('#nga-dirty-pill', { timeout: 3000 }).catch(() => null);
check('pill appears after staging an edit', !!pill);

const reviewBtn = await page.$('[data-testid="dirty-pill-review"]');
check('pill has a "Review & commit" button', !!reviewBtn);

// 2. Click the pill → a review/commit surface must open. THIS is the bug:
//    on the current bundle toggleChrome() is a no-op in embedded mode, so
//    nothing opens. After the fix the audit preview modal opens directly.
if (reviewBtn) await reviewBtn.click();
const modal = await page.waitForSelector('#ng-audit-preview-modal', { timeout: 3000 }).catch(() => null);
check('clicking the pill opens the review/commit surface', !!modal);

// 3. Confirm → onAuditSubmit must fire (commit reaches the host).
let submitFired = false;
if (modal) {
  const confirm = await page.$('[data-testid="audit-preview-confirm"]');
  check('review modal has a Confirm button', !!confirm);
  if (confirm) {
    await confirm.click();
    await page.waitForTimeout(500);
    submitFired = await page.evaluate(() => (window.__auditSubmitCalls || []).length > 0);
  }
}
check('Confirm fires onAuditSubmit (commit reaches host)', submitFired);

// 4. After a successful commit the staged buffer must clear (pill gone /
//    pending count 0) — otherwise the dirty signal lingers post-commit.
let cleared = false;
if (submitFired) {
  await page.waitForTimeout(300);
  cleared = await page.evaluate(() => {
    const pe = (window.__handle.getPendingEdits && window.__handle.getPendingEdits()) || [];
    const pillGone = !document.querySelector('#nga-dirty-pill');
    return pe.length === 0 && pillGone;
  });
}
check('buffer clears after successful commit (pill gone, 0 pending)', cleared);

await browser.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
