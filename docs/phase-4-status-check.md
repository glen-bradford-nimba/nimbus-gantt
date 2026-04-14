# Phase 4 Status Check — Salesforce consumes v10 template framework

**Date:** 2026-04-14
**Branch:** `feat/priority-grouping-v5-port`
**Commit under review:** `0ae1a72b` — "feat(gantt): Phase 4 — Salesforce consumes v10 template framework"
**Scratch org:** `Delivery Hub__dev` (test-bcqaurrchjr9@example.com, `00DO300000PxVm9MAF`)

---

## 1. Verdict: **GO for Phase 5**

All 7 audit gates pass. Server-side artifacts are in place, the IIFE still initializes, CSS has the expected Tailwind classes, the LWC deployed with the correct `cssUrl` wiring, and the test-only resource is gone. Safe to begin Phase 5 (Playwright regression harness).

---

## 2. Deployed artifact sizes (from org query)

Query: `SELECT Name, BodyLength, ContentType FROM StaticResource WHERE Name IN (...)`

| Name | BodyLength | ContentType | Expected | Match |
|---|---|---|---|---|
| `nimbusganttapp` | 205,360 bytes | application/javascript | ~205KB | yes |
| `cloudnimbustemplatecss` | 48,548 bytes | text/css | ~48KB | yes |
| `deliverytimeline` | 2,489 bytes | application/javascript | ~2KB | yes |
| `nimbusgantt` | 267,627 bytes | application/javascript | (legacy, still present) | ok |

Note: `nimbusgantt` (old monolithic bundle) is still deployed alongside — not loaded by v10 path but retained for safety. Can be pruned in a future cleanup PR.

---

## 3. LWC import check (deployed metadata)

Retrieved `LightningComponentBundle:deliveryProFormaTimeline` from scratch org and inspected deployed `deliveryProFormaTimeline.js`:

```
Line 16:  import CLOUDNIMBUS_CSS from '@salesforce/resourceUrl/cloudnimbustemplatecss';
Line 124:                 cssUrl: CLOUDNIMBUS_CSS,
```

Deployed file matches local repo verbatim — namespace tokens correctly stripped, CSS URL passed into the v10 mount call.

Source path (local): `C:/Projects/Delivery-Hub/force-app/main/default/lwc/deliveryProFormaTimeline/deliveryProFormaTimeline.js`

---

## 4. Repo clean state

```
commit 0ae1a72b03592454427eef4c210aa0a15fbdc16a
Author: glen-bradford-nimba
Date:   Tue Apr 14 12:59:56 2026 -0400

    feat(gantt): Phase 4 — Salesforce consumes v10 template framework

 lwc/deliveryProFormaTimeline/deliveryProFormaTimeline.js    |    2 +
 staticresources/cloudnimbustemplatecss.resource             |  726 +++
 staticresources/cloudnimbustemplatecss.resource-meta.xml    |    6 +
 staticresources/deliverytimeline.resource                   |   85 +-
 staticresources/nimbusganttapp.resource                     | 5248 +++++++++++++++-----
 5 files changed, 4706 insertions(+), 1361 deletions(-)
```

`git status` — no Phase-4-related unstaged changes. Working tree shows only pre-existing untracked items (COWORK_SESSION_NOTES.md, GANTT_GAPS.html, HANDOFF_escalation_test_failures.md, scripts/*, profiles/, Nimba_Sandbox RSS) — all unrelated to Phase 4. Branch is 15 commits ahead of origin.

---

## 5. Test cleanup

`ls force-app/main/default/staticresources/ | grep -i testcss` → **empty**. Both `testcssresource.resource` and its `.resource-meta.xml` are gone. Phase 0 probe leftover fully removed.

---

## 6. IIFE still functional

Node simulation (evaluates compiled IIFE with shimmed `window`):

```
mount: function templates: [ 'cloudnimbus', 'minimal' ]
```

`window.NimbusGanttApp.mount` is a function; `listTemplates()` returns `['cloudnimbus', 'minimal']` — the template framework loaded and self-registered correctly.

---

## 7. CSS has key classes

`grep -c "bg-violet-600|text-slate-500|rounded-full" cloudnimbustemplatecss.resource` → **5 matches**

Header confirms the file is the extracted Tailwind + `.ng-*` override bundle:

```
/* === nimbus-gantt cloudnimbus template.css ===
 * Extracted from cloudnimbusllc.com Next.js build output (Tailwind v4).
 * Contains the reset + theme variables + only the utilities used by
 * DeliveryTimelineV5 and gantt-demo components...
```

---

## 8. Scratch org URL (for manual browser test)

Glen: use `sf org open --target-org "Delivery Hub__dev"` from your shell to open a browser-authenticated session (the one-time frontdoor URL is ephemeral and sensitive — not pasted here). Navigate to the **Pro Forma Timeline** tab to view the rendered gantt.

Org: `Delivery Hub__dev`
User: `test-bcqaurrchjr9@example.com`
OrgId: `00DO300000PxVm9MAF`
Host: `saas-enterprise-2912-dev-ed.scratch.my.salesforce.com`

---

## 9. Expected visual outcome

Salesforce Pro Forma Timeline should render **identical chrome** to `cloudnimbusllc.com/mf/delivery-timeline-v10`:
- Same IIFE (`@nimbus-gantt/app` compiled bundle) drives rendering on both surfaces
- Same CSS (`cloudnimbustemplatecss` = extracted Next.js Tailwind output + `.ng-*` overrides)
- Same template selection (`cloudnimbus`)
- Same `NormalizedTask` shape fed in (Apex DTO → vanilla-JS normalizer in SF adapter; React `ProFormaAdapter.tsx` on /v10)

The only expected difference is data content: SF shows WorkItem__c records from the scratch org; /v10 shows proForma.ts seed. With 47 MF items seeded in both, they should look nearly indistinguishable.

If Glen sees divergence in spacing, colors, pill shapes, or row heights — that's a Phase 4b fixer loop, not a Phase 5 blocker (regression harness will catch it).

---

## 10. Next action

**Start Phase 5 — Playwright regression harness.** No Phase 4b loops needed from this audit; all server-side gates passed. Any visual divergence found during manual browser test becomes a Phase 5 input (golden-snapshot driven).

Phase 5 scope (per V10_PLAN.md):
- Playwright harness comparing `/v10` vs Salesforce tab screenshots
- Pixel-diff golden snapshots per template (`cloudnimbus`, `minimal`)
- CI hook on changes to `packages/app` or `cloudnimbustemplatecss.resource`
- Smoke test: mount → render → drag → patch roundtrip

---

## Appendix: Artifact source paths

- `C:/Projects/Delivery-Hub/force-app/main/default/staticresources/nimbusganttapp.resource` (205KB)
- `C:/Projects/Delivery-Hub/force-app/main/default/staticresources/cloudnimbustemplatecss.resource` (48KB)
- `C:/Projects/Delivery-Hub/force-app/main/default/staticresources/deliverytimeline.resource` (2KB)
- `C:/Projects/Delivery-Hub/force-app/main/default/lwc/deliveryProFormaTimeline/deliveryProFormaTimeline.js`
