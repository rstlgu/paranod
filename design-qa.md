# Settings window — design QA

final result: passed

## Visual target and evidence

The target is the user-supplied Claude settings screenshot. Local evidence is stored outside the repository in `/Users/ross/Projects/paranod-settings-preview-20261115/`.

- Source: `reference.png`, 2930 × 1822 pixels, normalized to 1465 × 911 CSS pixels (2× source density).
- Implementation: `settings-final.png`, 1465 × 911 pixels, captured in the in-app browser at the same CSS viewport, dark theme, General settings open above a synthetic investigation graph.
- Full-view comparison: `comparison-final.png`, source and implementation together.
- Focused comparison: `comparison-final-detail.png`, header, navigation, search and typography together at readable scale.
- Additional browser captures: `plugins-final.png`, `plugins-mobile-final.png` (390 × 844), `settings-light-final.png`; account mobile layout was also inspected.

## Findings and iteration history

All actionable P0/P1/P2 findings are resolved.

1. P2 — Typography inherited the technical Chakra Petch family. The first comparison (`comparison-before.png`) exposed the mismatch. Applied the neutral Geist font to this interface and its configuration dialogs. A second browser check revealed that the font variable was absent from the document; registered the existing Geist variable in the root font list. The final browser reports Geist and both final comparison images show the corrected typography.
2. P2 — Separate intercepted layouts remounted the window between settings and plugins. Consolidated them under one shared window layout. Browser navigation across categories retains one dialog and one surrounding frame.
3. P1 — The agent dock could lose its displayed graph when the overlay URL changed. The UI now resolves the underlying application route while the overlay is open. The agent panel and graph stay mounted; action execution still requires the actual active graph.
4. P1 — Direct entry followed by intercepted navigation could stack dialogs. Added a single-layer context, the implicit route fallback and lifecycle tests. Direct account entry, switching to Plugins and closing returns to the workspace with no remaining dialog or pointer lock.
5. P1 — Graph keyboard shortcuts used a window capture listener and could run behind a focused dialog button. The handler now excludes dialog controls. Regression tests cover navigation, copy, undo and deletion keys. In the final browser, Ctrl+B and Delete from Close settings leave the graph node and panel unchanged.

## Fidelity review

- Typography: neutral Geist, clear hierarchy, readable small text and visible keyboard focus. The rest of the application retains its existing branding.
- Layout rhythm: centered overlay, left search/navigation, independent right content scrolling, understated rows/dividers and rounded frame. The 1120px maximum width and 230px navigation intentionally accommodate existing Paranod forms and plugin controls. Mobile uses horizontally scrolling navigation and a full-height content pane; no content overflow at 390px.
- Colors: dark window #202020, sidebar #191919, muted dividers, selected navigation #373737 and dimmed application background. Light theme is also verified. Existing semantic status and action colors are retained.
- Assets: existing brand assets and library icons remain sharp. The reference contains interface controls and needs no generated raster assets.
- Content: actual Paranod sections and functionality are retained. English labels follow the application's existing language. Claude-specific billing and other unrelated settings are not reproduced.

## Functional verification

Verified navigation, search and empty search results, profile name save in a disposable account, plugin catalog and detail, centered plugin configuration and Cancel, dedicated Addons selection, manifest dialog and Escape, theme selection, Tab focus containment, direct links, close/reopen and restoration of the workspace and agent panel.

No real addon endpoint, API credentials or password change was submitted. Browser logs contain pre-existing graph logo-load failures for the synthetic domain; no settings-related exception was observed.

Validation: 110 Node tests and 805 unit tests passed (915 total); typecheck passed; production Docker build passed; full lint has zero errors and 285 existing warnings. The final keyboard change also passes targeted lint. Preview database and Docker resources are isolated from both existing installations.

## Implementation checklist

- [x] Shared settings window and complete existing sections
- [x] Primary interactions and responsive layouts checked in browser
- [x] Full-view and focused reference comparisons inspected after fixes
- [x] Keyboard isolation and lifecycle regression coverage
- [x] Production build, typecheck, tests and lint completed
- [x] Preview left running for review

## Follow-up polish

No blocking design issues remain. Domain-logo loading is an existing graph behavior outside this redesign. The preview intentionally has no live agent provider or external addon service attached.
