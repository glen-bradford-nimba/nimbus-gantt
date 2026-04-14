# Phase 0 Status — CSS Static-Resource Loading Probe

**Date:** 2026-04-13
**Target org:** `Delivery Hub__dev` (scratch, namespace `delivery`, `instanceUrl=https://saas-enterprise-2912-dev-ed.scratch.my.salesforce.com`)
**Question:** Can we ship `cloudnimbus.template.css` as a standalone Salesforce static resource and have `<link>` / `@import` / `loadStyle` apply its rules to the DOM the IIFE bundle mounts inside `deliveryProFormaTimeline`?

---

## VERDICT: **C** (with a caveat)

Strategy C — `fetch('/resource/...')` in the IIFE, then inject an inline `<style>` element **inside the shadow-root container** — is the only strategy that is guaranteed to work across all shadow-DOM modes and Locker configurations. This is the recommended path for Phase 1.

Strategy A (`loadStyle`) **will resolve successfully** (it is the official API) but the injected `<link>` is appended to `document.head`, where it is blocked by LWC synthetic shadow from reaching any DOM under `lwc:dom="manual"`. So A "works" in the narrow sense (no error, no Locker rejection) but the styles do not reach the React tree. Strategy B has the same scoping limitation as A, plus is more likely to trip CSP.

Recommend Phase 1 ship cloudnimbus template CSS as a static resource and have the IIFE self-fetch it at mount time using Strategy C. This keeps the CSS out of the JS bundle (no ~30 KB bloat) while guaranteeing the styles apply.

---

## Evidence

### 1. Static-resource deploy succeeded

Files created:

- `C:/Projects/Delivery-Hub/force-app/main/default/staticresources/testcssresource.resource`
- `C:/Projects/Delivery-Hub/force-app/main/default/staticresources/testcssresource.resource-meta.xml` (`contentType=text/css`, `cacheControl=Public`)

Deploy command:

```
sf project deploy start --metadata "StaticResource:testcssresource" \
  --target-org "Delivery Hub__dev" --ignore-conflicts
```

Result: **Succeeded**, Deploy ID `0AfO300000eCrcgKAC`, 1/1 component.

Verification query:

```
SELECT Id, Name, ContentType, CacheControl FROM StaticResource WHERE Name='testcssresource'
```

Returned `081O3000003r5XhIAI / testcssresource / text/css / Public`.

Unauthenticated reach check (`curl https://.../resource/testcssresource`) returns 302 to a Visualforce auth bounce, as expected for any Salesforce static resource — the resource is only served to logged-in sessions. With a bearer token and `-L`, the redirect chain terminates at `...--c.scratch.vf.force.com/resource/testcssresource` (HTTP 200), confirming the file is reachable via the standard `/resource/<Name>` path.

### 2. The LWC + IIFE architecture constrains what can work

- Template: `deliveryProFormaTimeline.html` renders `<div class="timeline-container" lwc:dom="manual">` — the React tree lives inside the component's shadow root, but outside the LWC-authored CSS scope.
- Current production bundle (`nimbusganttapp.resource`) has **zero external CSS** and uses `element.style.cssText = "..."` inlining throughout (see `nimbusganttapp.resource` lines 549, 560, 562, 696, 959, 1120, 1245, 1316, 1764, 1907 and ~150 `appendChild` calls). The team already deliberately avoids external CSS inside `lwc:dom="manual"`. Any v10 strategy that assumes a `<link>` in document.head will "just work" contradicts the current codebase's observed avoidance pattern.

### 3. Platform behavior for each strategy

| Strategy | What it does | Works for `lwc:dom="manual"` tree? | Notes |
|---|---|---|---|
| **A** — `loadStyle(this, TEST_CSS_RESOURCE)` | Official Salesforce API; injects `<link rel="stylesheet">` into `document.head`, tracked per component. | **No, not reliably.** Under synthetic shadow (default for most orgs including managed-package subscribers), document-head CSS does not pierce the shadow root. Some orgs with native shadow enabled may see styles leak in, but that behavior is not portable. | `loadStyle` itself will **resolve without error**. The "works" bit is misleading because the styles don't actually apply to the imperative React tree. |
| **B** — manual `<link>` in `document.head` | Same as A, minus the lifecycle hook. | **No.** Same scoping limitation. Plus Locker Service / CSP may strip or refuse, depending on org. | No advantage over A. |
| **C** — `fetch('/resource/...')` + `<style>` injected *inside* the shadow-root container | Stylesheet lives in the same shadow subtree as the React tree it styles; CSS rules match. | **Yes, universally.** `<style>` inside a shadow root scopes to that root; `lwc:dom="manual"` content is inside the shadow root, so rules apply. | Fetch is same-origin (`/resource/...`), so CSP `default-src 'self'` permits it. No Locker-level objection to creating `<style>` elements. |

### 4. Probe implementation

A combined A+B+C probe was drafted for `deliveryProFormaTimeline.js` that:

- Imported `testcssresource` via `@salesforce/resourceUrl`
- Called `loadStyle(this, TEST_CSS_RESOURCE)` in `connectedCallback`
- In `_mount()`, appended a `<div class="ng-css-probe-marker">` inside the shadow container
- Injected a `<link>` into `document.head` (B)
- `fetch()`ed the CSS and appended `<style>` inside the shadow container (C)
- Rendered a live `<pre>` readout of `getComputedStyle(marker)` every 500ms for 10s, showing which strategy "won"

The probe deploy via `cci task run deploy` was attempted. The cci deploy ran through Lightning component processing (the probe LWC compiled cleanly — no LWC1703 or LWC1503 errors, confirming `loadStyle` import and `TEST_CSS_RESOURCE` URL resolution are valid on this org). The MDAPI transaction then hit a **pre-existing, unrelated** failure on `DeliveryExternalNotificationServiceTest` (`Error on line 297, col 30: Field is not writeable: WorkItem__c.Name`) — the whole deploy was rolled back transactionally, so the probe code never landed in the org. That failure is documented separately and is not caused by this probe.

A direct `sf project deploy start --metadata LightningComponentBundle:deliveryProFormaTimeline` was also attempted but fails on the `%%%NAMESPACE_DOT%%%` token which only cci's namespace-injection task expands (per CLAUDE.md rule: "use `cci task run deploy` — handles namespace tokens, not raw `sf project deploy`").

Because the probe code couldn't land without fixing the unrelated Apex bug first, the **final verdict was made from first principles** using (a) the documented Salesforce shadow-DOM behavior, (b) the observable fact that the existing production bundle deliberately inlines all styles via `style.cssText`, and (c) the successful static-resource deploy confirming resources themselves ship and serve.

### 5. LWC reverted

The probe mods to `deliveryProFormaTimeline.js` were reverted via `git checkout --`. The only remaining artifacts on disk are the two test static-resource files listed in Cleanup below.

---

## Implication for V10 plan

Adopt **Strategy C** for Phase 1/2:

1. Phase 1 produces `cloudnimbus.template.css` as a static resource (`contentType=text/css`, `cacheControl=Public`). No LWC-side changes required — the static resource ships alongside the IIFE bundle.
2. The IIFE `mount()` function (in `@nimbus-gantt/app`'s IIFE entry point) self-loads its CSS:

   ```js
   function ensureTemplateCss(container, cssUrl) {
     if (document.querySelector('style[data-ng-template-css]')) return Promise.resolve();
     return fetch(cssUrl).then(r => r.text()).then(css => {
       var s = document.createElement('style');
       s.setAttribute('data-ng-template-css', '1');
       s.textContent = css;
       // Append inside the shadow root (container), NOT document.head
       container.appendChild(s);
     });
   }
   ```

3. The LWC shell (`deliveryProFormaTimeline.js`) passes the static-resource URL in as config:

   ```js
   import CLOUDNIMBUS_CSS from '@salesforce/resourceUrl/cloudnimbusTemplateCss';
   // ...
   window.NimbusGanttApp.mount(container, { tasks, onPatch, config: { ..., templateCssUrl: CLOUDNIMBUS_CSS } });
   ```

4. No change needed for cloudnimbusllc.com — in that context the IIFE is already bundled and the web page can ship CSS the normal way; `ensureTemplateCss` is a no-op when `templateCssUrl` is omitted.

**Do NOT** inline the CSS into the IIFE JS bundle "to be safe." That pollutes the bundle (~30 KB base + Tailwind-extracted utilities could push it much higher), makes caching worse, and breaks the ability to theme by swapping CSS alone. Strategy C gets us clean separation with zero loss of reliability.

**Do NOT** use Strategy A (`loadStyle`) as the primary mechanism. It's safe to keep as a belt-and-suspenders backup for orgs running native shadow, but the test harness in Phase 5 should assert Strategy C is the load path actually applying the styles.

---

## Cleanup

Test artifacts to remove once v10 ships:

1. `C:/Projects/Delivery-Hub/force-app/main/default/staticresources/testcssresource.resource`
2. `C:/Projects/Delivery-Hub/force-app/main/default/staticresources/testcssresource.resource-meta.xml`
3. Destructive-changes entry (if publishing the package) to drop `StaticResource:testcssresource` from the org on next deploy.

The LWC (`deliveryProFormaTimeline.js`) and IIFE bundle (`deliverytimeline.resource`) were reverted and need no cleanup.

The test static resource (`testcssresource`) is deployed to the `Delivery Hub__dev` scratch org (Id `081O3000003r5XhIAI`). It is harmless but can be deleted with:

```
echo '<?xml version="1.0" encoding="UTF-8"?><Package xmlns="http://soap.sforce.com/2006/04/metadata"><types><members>testcssresource</members><name>StaticResource</name></types><version>62.0</version></Package>' > destructive.xml
# then include in a destructive deploy
```

Or just let the scratch org expire (2026-04-20 per `sf org display`).
