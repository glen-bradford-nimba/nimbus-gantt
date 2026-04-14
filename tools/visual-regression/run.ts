/**
 * run.ts — orchestrator: capture → compare → report, one command.
 *
 * Exit codes:
 *   0 — overall verdict is pass or warn
 *   1 — overall verdict is fail, OR any hard navigation error during capture
 */

import { capture } from './capture.ts';
import { compare } from './compare.ts';
import { renderReport } from './report.ts';

async function main(): Promise<void> {
  console.log('=== nimbus-gantt visual regression ===');

  const captureResults = await capture();
  const hardFails = captureResults.filter((r) => !r.navigationOk);
  if (hardFails.length > 0) {
    console.error('\n[run] Capture had hard failures; aborting.');
    for (const r of hardFails) console.error(`  - ${r.targetId}: ${r.error}`);
    process.exit(1);
  }

  const report = await compare();
  const path = await renderReport();

  console.log(`\n=== DONE ===`);
  console.log(`Report: file://${path.replace(/\\/g, '/')}`);
  console.log(`Overall verdict: ${report.overall}`);

  if (report.overall === 'fail') process.exit(1);
}

main().catch((err) => {
  console.error('[run] fatal:', err);
  process.exit(1);
});
