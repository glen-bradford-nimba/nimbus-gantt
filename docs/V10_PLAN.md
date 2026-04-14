# Plan: nimbus-gantt v10 — Template-as-Framework

## North Star
`@nimbus-gantt/app` becomes a template-driven framework. Ships with a default `cloudnimbus` template containing v8/v9's full UI (HTML + CSS + layout + feature set). Consumers pass config/data, optionally override. Custom templates are first-class. One source of truth. Same rendering everywhere.

```tsx
// Default — gets the full "cloudnimbus template" look automatically
<NimbusGanttApp template="cloudnimbus" data={tasks} onPatch={save} />

// Override specific features
<NimbusGanttApp template="cloudnimbus" data={tasks} onPatch={save}
  overrides={{ features: { audit: false }, theme: { primary: '#7c3aed' } }} />

// Custom template extending cloudnimbus
const MyTemplate = defineTemplate({ extends: 'cloudnimbus', ... });
<NimbusGanttApp template={MyTemplate} data={tasks} onPatch={save} />
```

## Critical constraints
- **v8 and v9 are NEVER modified.** v10 is a new route.
- Template framework is generic — not hardcoded to cloudnimbus.
- Every phase has a status-check agent run after it before proceeding.

## Phases

### Phase 0 — CSP probe (1 agent, ~30 min)
Deploy a test CSS static resource, verify Locker Service loads it. GO/NO-GO gate.

### Phase 1 — Extract v8/v9 into canonical `cloudnimbus` template (3 parallel agents, ~2 hours)
- Agent 1A (Explore): Parse DeliveryTimelineV5.tsx → `v10-component-spec.md`
- Agent 1B (general-purpose): Build cloudnimbusllc.com, extract Tailwind utilities → `cloudnimbus.template.css`
- Agent 1C (Plan): Design Template interface → `template-api-design.md`

### Phase 2 — Implement template framework in @nimbus-gantt/app (1 agent, ~3 hours)
Create `packages/app/src/templates/` with registry, resolver, cloudnimbus template (components + styles), and minimal template. Rewrite NimbusGanttAppReact.tsx and IIFEApp.ts to use the template framework.

### Phase 3 — Ship v10 route on cloudnimbusllc.com (1 agent, ~30 min)
Create `/mf/delivery-timeline-v10` using `<NimbusGanttApp template="cloudnimbus" />`. v8 and v9 untouched.

### Phase 4 — Salesforce parity (1 agent, ~45 min)
Deploy new IIFE + template CSS to Salesforce. Verify visual match to v10.

### Phase 5 — Visual regression harness (1 agent, ~2 hours)
Playwright + pixelmatch. Fails on >2% drift. CI-ready.

### Phase 6 — Documentation: custom templates + overrides (1 agent, ~30 min)
Docs for building templates and using overrides. Lock in template-building as first-class.

## Gap-analysis / status checks between phases
After EACH phase completes, run a dedicated agent that:
1. Reads what the phase produced
2. Verifies it against the plan's expected deliverables
3. Flags gaps, regressions, scope creep
4. Produces a `phase-N-status.md` report
5. Answers: "are we still on track for identical v10/Salesforce rendering?"

Status-check agents run BEFORE approval gates — they inform the approval decision.

## Approval gates
1. After Phase 0 probe → confirm CSS strategy
2. After Phase 1 status check → approve API design
3. After Phase 2 status check → typecheck + IIFE builds
4. After Phase 3 status check → v10 matches v9 visually
5. After Phase 4 status check → Salesforce matches v10
6. After Phase 5 status check → harness catches known differences

## Total effort: ~9-10 hours agent work + ~1-2 hours status checks
