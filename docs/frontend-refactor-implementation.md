# Web frontend refactor implementation

Started 10 October 2026 after explicit human authorization. This is local web development. No Git push, hosted deployment or remote business-data mutation is part of this work.

## Baseline and scope

The functional auditor preserved 427 source files, including existing uncommitted work, under ignored `work/qa/function-audit-20261010/baseline`. The visual auditor built and copied an immutable isolated Worker with a separate D1 database. Baseline browser evidence is in ignored `work/qa/frontend-visual/`.

The first visible battery link in the baseline was at y=552.28125 on a 1280×720 viewport and y=935.375 on a 390×844 viewport, with scrollY=0. These are local browser observations from the visual auditor, not staff efficiency measurements. Closing details or cancelling an inventory export left focus on BODY in those baseline checks.

The after-4 checkpoint is retained as a stable engineering foundation, not final UX acceptance. Human review required a structural product redesign beyond refinements to the earlier composition. The structural phase carried forward the existing authentication, focus, responsive-interaction and business-guard fixes. Its recorded automated regressions, structural-3 interactions, structural-4 station-focus and 320px toolbar checks, and structural-5 Scan input and desktop filter-row checks passed at those historical snapshots. Human review subsequently accepted the overall structure and requested a unified visual finish. The completed local visual-finish checks and final source anchors are recorded separately below; earlier evidence retains its original snapshot scope.

## First implementation

- Replaced the sign-in composition and added explicit check/retry/submission/opening states. The initial check aborts on unmount and ignores late results. Successful administrator setup still requires separate sign-in. Successful sign-in requires a user in the server response and keeps the sanitized return path.
- Consolidated overlapping workspace style layers into their component owners. Added a dedicated authentication stylesheet. This foundation snapshot used blue for actions, selection and focus while retaining a warm battery identity mark; the current visual finish replaces that mark with blue and white and keeps independent status colors.
- Reordered workspace hierarchy and reduced repeated framing. Data context is an expandable, source-labelled disclosure. Three status tabs, ordinary filters, New arrivals, fixed personal/group scope and all business actions remain governed by their existing handlers.
- Reflowed the single inventory table into labelled narrow-screen records. No duplicate mobile state or event handlers were added. Selection, row interaction exclusions, detail actions, current holder, owner, storage and all expandable evidence are retained.
- Consolidated the detail sheet's competing width rules into its CSS module.
- Added composable opener restoration to shared dialogs and sheets. Explicit caller focus handling takes precedence; newly opened dialogs and workspace navigation retain focus.

## Current structural rework

- Moved inventory scope, refresh and the source disclosure into the global header with the signed-in account. The expanded desktop navigation is now 208px wide; the workspace title belongs to the content area below.
- Paired the record register with a persistent Review queue for selected identities and existing guarded actions. Register battery is in the compact inventory title row; at widths up to 767px its visible label is Register and its accessible name remains Register battery. The compact inventory title uses 25px text at that width. Scan checkout and Scan return are in the queue. Selection continues to require an explicit reviewed confirmation before a movement is saved.
- The Review queue now aligns with the records top. At a measured workbench width of at least 1100px, it uses a 280px sticky grid column with a 16px gap; closed state leaves a 52px labelled entry and 12px gap. Smaller workbenches use a modal Sheet. At viewports up to 767px the entry occupies a 44px row above full-width records. No floating bottom panel or bottom page reservation remains.
- Placed New arrivals beside Filter in the shared inventory toolbar, retaining its removable criterion and original acknowledgement behavior. It is not a fourth status tab and is absent from personal views and opened teaching groups. On narrow screens, Applied filters and its disabled Clear control are hidden only when there are no active criteria. Removing a chip or clearing criteria first focuses Filter without clearing selected records or fixed scope.
- ReviewQueueSurface owns only layout, focus and scroll. Selection, filters, pagination, the group editor, totals disclosure and business callbacks remain in InventoryTable. Desktop and Sheet presentation containers remount across modes; this is not permanent DOM retention. Business overlays defer mode changes. Hidden retained inventory releases the Sheet through active=false without clearing the saved opening choice. Queue opening does not enter the business modal lock. Semantic focus restoration skips unavailable targets and retains the single body scroll position. The former bottom-floating queue-focus helper is no longer imported.
- Unified navigation, header, queue, sign-in identity and popup materials over a neutral near-white canvas, with blue-and-white branding and favicon. `styles/materials.css` is the final import after motion and owns shared material states, preference fallbacks and toolbar metrics, not feature layout. Supported browsers use 88% white at rest, 98% on focus within or fine-pointer hover, and 96% on coarse-pointer/hoverless devices. Data, selected-record items, evidence and forms remain opaque. Reduced-transparency and forced-color rules replace all material-state tokens with solid surfaces and remove blur. Reduced motion removes material transitions. These rules do not establish contrast across all composite states or complete browser preference support.
- Standardized toolbar controls around a 44px minimum height, the shared control radius and icon spacing, including nested pagination and Clear filters. Pressed New arrivals retains its selected style on hover. Ordinary In use and scan information use informational/neutral colors; recorded concerns, recovery, uncertain or pending work, scope changes and capacity limits retain warning colors.
- Receipt actions now follow the 44px shared-toolbar height while keeping the 48px workstation default. Pending/check circle width and pending/check/confirmed radius targets use the untransformed computed control height, falling back to `offsetHeight`, so a press-scale transform cannot contaminate those targets.
- Replaced the centered sign-in card with a full-height desktop split: a 36% identity area and an open white form area. Translucent brand and Register / Check out / Return / Trace panels sit over the identity background. Below 900px, the brand strip leads directly into the 48px form controls. Setup and error content use natural page scrolling. State, effects, requests, callbacks, retries and immediate server-confirmed navigation are unchanged by this layout rewrite.
- Added `lib/client/station-focus.ts` through an independent `WorkspaceMotion` layout effect. It measures the topbar height to place persistent station exit bars below it. On the frame after station focus changes, it scrolls only when the focused control is obscured or inside the intended 12px clearance below those surfaces. Hidden/inert targets, dialog content and the exit bar's own controls are excluded. The helper does not move focus or modify station business components, requests or drafts. Its independent probe and recorded 320px station browser checks passed, as detailed below.

## Transition register

| Pattern | Presentation | State and interruption rule |
| --- | --- | --- |
| Sign-in entry | Static split composition; pending progress icon | Controls follow authentication readiness; the layout adds no entry delay |
| Submit | Immediate label and progress icon; subtle press | One pending request; no minimum wait; failure preserves inputs |
| Authentication confirmation | Confirmed opening label followed immediately by navigation | Requires server confirmation; setup does not authenticate |
| Sidebar | Existing coordinated spring, one active marker | Current view is authoritative; interruption replaces motion |
| Filters / page change | Current list fades briefly | Criteria and identities update synchronously |
| Detail / form opening | Short overlay entrance | Original state remains mounted under its existing key |
| Disclosure | Retained subtree with inert closed content | Closing returns internal focus before hiding; draft is retained |
| Review queue | Measured sticky auxiliary column or modal Sheet; labelled compact entry | User-controlled opening persists; business overlays defer mode changes; semantic focus and body scroll restore across presentation mounts |
| Receipt acknowledgement | Pending/check/result geometry driven by the shared spring; optional 190ms check phase | Requires a new confirmed server receipt; reduced motion settles geometry and completes an active check phase immediately; presentation never commits or retries a request |
| Approved informational close | Immediate real teardown, with a 120ms inert visual copy for ordinary battery details and export | The domain handler approves closure first. The copy has no React lifecycle, identifiers, form submission, pointer or focus access; new input, a new dialog or a reduced-motion change removes it |
| Transaction / recovery / context switch | Immediate teardown when allowed | Original requests, pending writes, protected forms and receipts retain their existing lifecycle; no visual copy extends a business transaction |

Reduced motion skips new spatial animations and preserves state feedback. Dynamic preference changes cancel active workspace-transition and observer WAAPI animations and remove the informational-exit copy. The shared spring now listens during motion, renders its target, resets velocity and finishes immediately when the preference switches on. `ReceiptAction` listens during its optional 190ms check phase and immediately displays the confirmed result; its geometry inherits the spring behavior. Controlled preference-change probes passed for these paths. The former startup-only limitation is fixed in source, but changing the operating-system preference during animation in a real browser has not been tested; complete browser preference support is not claimed.

## Actual checks and evidence boundaries

The foundation results below belong to their original snapshots through after-4. They are preserved as engineering evidence and must not be presented as validation of the structural rework or current visual finish. Later structural evidence is recorded separately under Historical structural revision evidence.

First coherent production build: successful. TypeScript `--noEmit --incremental false`: successful. ESLint over changed TSX/hook sources: successful. Build retains a pre-existing large-chunk warning; this is not a measured loading-performance result.

Independent functional audit reported 610 distinct baseline cases passing, 335 after-1 regressions passing and 348 frozen after-2 regressions passing. Foundation sign-in probes passed 14/14; shared focus probes passed 15/15 after prioritizing explicit workspace navigation; the informational-exit helper passed 16/16. Updated foundation UI harnesses passed 42/42. The private probes directly invoke handlers for some defensive cases; they do not establish a real-browser exploit in the old UI. Refer to the functional auditor's ledger for exact snapshots, overlapping suites and evidence; these figures must not be added into a unique total.

The isolated mobile compatibility copy synchronized 132 shared client files, built successfully with its native configuration loader and passed 38 mobile tests. The main native source/build and hosted application were not changed. Physical-device acceptance remains separate.

First-checkpoint browser review confirmed sign-in failure feedback, nested details/export focus restoration, selection retained outside a filter, explicit checkout cancellation and confirmation, exact return and filtered CSV scope. It also found excess login height, a mobile navigation focus race, a short asset-link target and weak control borders. The second build addresses those findings and compacts mobile inventory framing. The control border now uses #7d899a, with static ratios of 3.55:1 on white, 3.25:1 on the subtle surface and 3.15:1 on the selection surface. Real compositing still needs browser review.

Second-preview browser checks confirmed that normal sign-in fits 1280 by 720 and 320 by 740, the measured input border is 3.549:1 against white, and navigation focus remains in the workspace after the sidebar closes. Detail dismissal leaves no dialog or decorative copy after settling. The narrow inventory's first View BAT-001 moved from y=935.375 to y=640.03125 at 390 by 844; this is a layout measurement, not staff efficiency.

Third-preview corrections addressed 320px status/directory-tab clipping, administrator identity overlap, intake overflow and the inventory checkbox target. The implementation chat measured all four directory tabs at 119.5 by 44px and successfully opened Batteries. Intake document width fell from 358px to 305px in a 320px viewport; its long confirmation button is 243 by 56px and its sticky Exit remains visible. Staff-account, task-editor and teaching-group draft overlays were opened and cancelled without account or business mutations. Administrative evidence tables keep local horizontal scrolling.

The after-4 foundation layout refinements touched six files: five stylesheets and the RecordManagement section's CSS class. They did not alter business handlers, keys or payloads. TypeScript, the modified TSX lint, production builds and scoped whitespace checks passed. Existing large-chunk warnings remained.

The after-4 immutable foundation preview is `work/qa/api-a0pT8A`. At 320 by 844 the administrator header was 59.78125px high, the full Administrator word fitted, and identity/Sign out had a 6px gap. At 390 by 844 all three inventory tabs were 44px high with their labels and counts on one line. The after-4 intake retest retained a 305px document width, 277px panels and a 243 by 56px confirmation button at 320px. Evidence screenshots are `work/qa/frontend-visual/after-4-admin-inventory-320.jpg` and `after-4-admin-inventory-390.jpg`; the preceding unchanged directory/intake layout is recorded in `after-3-admin-records-320.jpg` and `after-3-admin-intake-320.jpg`. The visual audit records the independent staff, inventory and desktop measurements. All native outputs and hosted business data remain intact.

The after-4 desktop inventory observation at 1280 by 720 put the first View BAT-001 at y=480.3125, compared with the baseline y=552.28125; approximately three records fitted instead of two. The after-4 independent staff check at 390 by 844 placed it at y=636.03125, compared with y=935.375. These measurements used scrollY=0 and disposable preview data. The desktop screenshot is `work/qa/frontend-visual/after-4-admin-inventory-desktop.jpg`. No performance or workload percentage is inferred from the change in geometry.

### Historical structural revision evidence

Recorded structural checkpoints passed TypeScript checking, modified-source ESLint and production builds. The builds retain the pre-existing large-chunk warning. Structural-3, structural-4 and structural-5 below are historical snapshots. Their results and queue-focus expectations do not extend automatically to the current material, queue or motion changes.

The initial structural regression closed with 176 distinct cases passing, including resolution of the harness lookup issue through the affected ten-case rerun. Separate authentication and inventory-query checks passed 14 and 21 cases respectively. The latest affected rerun passed all 49 cases across four suites. The reverse-breakpoint focus probe passed 15/15, the queue blur-handler probe passed 9/9 and the independent station-focus probe passed 32/32. These suites and reruns overlap and must not be added into a combined coverage total. The functional audit retains the earlier failures, their fixes and exact source evidence.

An isolated structural mobile compatibility copy synchronized 132 shared client files and built successfully. This run predates the final small focus changes and station helper; it is not a build of the latest source. Unchanged mobile business suites were not rerun for that copy. Main native outputs and hosted data were unchanged, and native/physical-device acceptance is not inferred.

A subsequent private mobile compatibility copy synchronized 133 shared files and built successfully. The main mobile project remained unchanged. This later captured version provides additional shared-client compatibility evidence, not a physical-device result or a pass for subsequent mobile Scan layout edits.

The coordinator reported these actual browser passes against the structural-3 fixture preview:

- Clear filters and chip removal focus Filter.
- Changing from compact to desktop while the queue toggle is focused moves focus to the surviving queue heading.
- Closing details restores the visible queue opener. Cancelling Download selected on desktop and then narrowing to 390px keeps the focused action visible in the expanded queue.
- Cancelling checkout preserves 6 in / 0 out and restores Check out selected focus. Confirming BAT-001 checkout produces 5 in / 1 out; reviewing and confirming its exact return restores 6 in / 0 out. The recorded actor is the native staff account. These are local fixture operations, not hosted business mutations.

The implementation chat recorded these actual structural-4 station focus measurements at a 320px viewport. The topbar occupied y=0–107px and the persistent exit bars began at y=115px. Each recorded control passed the center-point hit test, and each station's document width was 305px, below the viewport width.

| Station / focused control | Control top–bottom (px) | Exit-bar bottom (px) |
| --- | --- | --- |
| Intake / first-use control | 384–428 | 371.8125 |
| Intake / preceding date-picker control | 384–420 | 371.8125 |
| Removal / kind control | 390.156–434.156 | 377.75 |
| Scan / tag input | 398.718–444.718 | 379.5 |

Intake, Removal and Scan exited normally after inspection. No writes were performed during these station-focus checks. Screenshots are `work/qa/frontend-visual/structural-4-admin-intake-focus-320.jpg`, `work/qa/frontend-visual/structural-4-admin-removal-focus-320.jpg` and `work/qa/frontend-visual/structural-4-admin-scan-focus-320.jpg`. These are observations of the recorded controls and states, not exhaustive station or viewport coverage.

The coordinator also measured the 320px inventory toolbar: Filter was 79.67px wide, New arrivals 116.70px and Download 44px. All three shared y=292.484–336.484px, giving each a 44px height, and document width remained 305px. This closes the earlier narrow-toolbar browser check for that preview.

The final preview of the historical structural-5 snapshot was the isolated local fixture `work/qa/api-E7iLTV`, served at `http://localhost:59866`. Its production build and scoped whitespace checks passed. This was a local engineering checkpoint; no Git push or hosted deployment was performed.

At structural-5, the Scan tag input and Add tag to review button stacked below 641px. At 320 by 844px the input measured 207 by 46px at y=391.718–437.718, with the complete `DEMO-TAG-001` value visible. The button measured 207 by 44px at y=445.718–489.718. Both passed center-point hit tests below the station bar ending at y=379.5; document width remained 305px. The input was cleared and the station exited without submitting a tag or recording a movement. Evidence: `work/qa/frontend-visual/structural-5-admin-scan-focus-320.jpg`.

At structural-5 desktop widths, active Applied filters occupied a complete second toolbar row. The coordinator measured a 701 by 34px row with Search BAT-002 and Clear filters on the same line; Filter, New arrivals, matching count and Download remained on the first line. Empty criteria retained the compact layout. That preview's browser console had no warnings or errors. Evidence: `work/qa/frontend-visual/structural-5-filtered-selection-desktop.jpg` and `structural-5-inventory-desktop.jpg`.

The implementation chat also saved `work/qa/frontend-visual/structural-5-admin-inventory-desktop-top.jpg` at 1280 by 720px, scrollY=0, with the first View BAT-001 at y=344.8125px. At that handoff the browser tab was returned to the default viewport, ordinary inventory and an empty queue.

The last two structural-5 corrections were CSS only; handlers and the station helper remained unchanged. These historical SHA-256 anchors identify that snapshot, not the current source:

| Source | SHA-256 |
| --- | --- |
| `styles/inventory.css` | `7f6a563fe6498d247fd9f5981938af91ad3ed4bae23881235e8b7921ba625d92` |
| `styles/workflows.css` | `ba3889b9ff0f4860a982bb4bea33e2d175360a598afed2f7ef2ceeb5ed434bfc` |
| `components/inventory/inventory-table.tsx` | `d3e562a2cd5e8ba4eb485941a701e2ed874171c0b5affab5d2f4c5682efa0c56` |
| `lib/client/station-focus.ts` | `b791b0bb88fae02eb217b3d9ed1b36164a1b6339b1bb6d1b684b42e0960c21f0` |

Earlier structural checks remain scoped to their recorded snapshots. The structural-5 CSS checks closed its two observed layout issues; they do not extend the automated or native coverage beyond that recorded scope. In particular, the former blur-collapse and reverse-breakpoint probes describe the earlier queue implementation, not current queue behavior.

### Historical visual finish and local verification (polish-1 through polish-5)

The polish-era source implemented neutral materials and branding, shared toolbar metrics, a default-collapsed queue at every breakpoint, retained user-controlled opening and temporary focus-driven queue height limits. It also fixes runtime reduced-motion interruption for the shared spring, workspace-transition WAAPI animations and the receipt check phase. Workbench resize, layout-transition completion and cancellation recheck the current focused control without changing focus identity or the user's open state. The cancellation callback handles the source-derived risk of a reduced-motion change cancelling a transition before its end event; this risk was not reproduced by changing operating-system settings in the browser.

The coordinator's polish-2 real-browser checks passed upper and lower hit tests on the complete 111.5px wrapped filter chip with the queue open: the chip spans y119.08–230.58 and the queue starts at y243.39. Directory Search, Clear and Download measured 44px high, including the idle and confirmed Download states. A two-record spreadsheet download completed with explicit browser-save feedback. The prior failing screenshots and intermediate fixes remain in the independent audits.

Visual polish-3 closed the resize focus defect: after 1280 by 720 changes to 390 by 844, Batteries per page spans y118.906–162.906 above the queue at y218.328, with a successful hit test and unchanged focus identity and queue opening. At 390 by 600 the same control remains visible above queueTop193. Visual polish-4 repeats the 390 by 844 pass against the final cancellation-aware source. At its initial desktop load the queue is closed, count zero, and the register's grid is 1009px plus a zero-width queue column. Browser console warnings and errors were empty. Screenshots include `work/qa/frontend-visual/polish-4-inventory-desktop.jpg` and the earlier targeted `polish-3-resize-focus-390.jpg`.

The polish-era local web preview is the isolated fixture `work/qa/api-hLyye5`, served at `http://audit.localhost:56675`. The original user preview on port 59866 and its subsequent business activity remain intact. That frozen source passed TypeScript, changed-source ESLint and a production build; the existing large-chunk build warning remains. The independent frozen affected regression passed 88/88; receipt geometry passed 20/20, and the scan capacity-warning callback passed 11/11. The shared motion and disclosure probe passed 23/23. These overlapping checks and successive reruns are not a combined total. The functional audit records the final transition-cancellation follow-up and private mobile compatibility evidence, including exact snapshots and limitations.

The implementation chat also checked the preceding polish-3 administrator preview: Directory Search, Clear and Download measured 44px with a 10px radius, then returned to ordinary inventory with an empty collapsed queue and no console warnings or errors. The final source adds only the filtered transition-cancellation recheck to that product snapshot. No Git push, hosted deployment or native-device acceptance is implied by this local handoff.

The final cancellation-callback probe passed 14/14. Removing that added property reproduces the preceding complete InventoryTable source, so the preceding 88-case regression is retained with its original scope instead of reported as a new run. The final private mobile copy synchronized 135 shared files and built successfully; only the generated shared inventory-table module changed from the previous compatibility copy. All 48 recorded inputs stayed stable during that build, and the main mobile generated manifest was unchanged. These are controlled-callback and shared-client build checks, not physical-device, NFC or operating-system preference tests.

Final product SHA-256 anchors:

| Source | SHA-256 |
| --- | --- |
| `components/inventory/inventory-table.tsx` | `cbb4c47edf6f13ed71cd20028df7e543f6e7c1dec5f0992ab34f54840692125e` |
| `lib/client/queue-focus.ts` | `370d9070b3e3d6b99cadcbc575d185edf7c27c2e9a128d94ee561db6c7dc0d33` |
| `components/ui/receipt-action.tsx` | `9308ff86d44ba5553f05156056d9b031abd4a00735a847cc2e1414fd5f20cd05` |
| `lib/client/workspace-motion.ts` | `1f4c52c50fcef167518a1b2dc4a15549fcce10a145534229210e01a56568df5f` |
| `styles/materials.css` | `3a06bfea9e93a5c90e597642e448baf50478e983b4aede5c46387e0cac3ed9c2` |
| `styles/theme.css` | `c604643199537eb8219300bb8b9d296c9df18ac43609485ad5f113f263dbc91a` |
| `components/inventory/scan-station.tsx` | `ec2f4ccea223dbb621683cbacddaa8084ace088ff6617ebe63d48410005a22b4` |

Unmeasured: complete WCAG conformance, Apple comparison parity, latency percentiles and animation frame stability, real staff workload improvement, physical iPhone/Android acceptance, real-browser operating-system preference switching, and an exhaustive browser matrix of recovery/network faults. Controlled and isolated D1 checks cover relevant business guards but do not replace those checks.

### Top-aligned auxiliary queue revision

Human review of the delivered polish preview identified the empty reserved column above its bottom-fixed expanded queue. This follow-up changes presentation only. The old user previews on ports 56675 and 59866 and their data remain intact; browser verification uses a new isolated fixture and hostname.

The responsive rules are now based on the complete workbench width rather than viewport width alone, so opening or closing the left navigation is accounted for. A 1100px minimum permits 804px records, a 16px gap and a 280px auxiliary column. Closed desktop state reserves only a labelled 52px rail plus 12px gap. The expanded column begins at the records top, sticks below the measured topbar and has one scrollable body. On smaller workbenches the existing modal Sheet owns focus and interaction layering. At viewport widths up to 767px, a 44px horizontal entry above full-width records replaces the rail. Hover does not open the queue.

ReviewQueueSurface contains no request, selection, filter or business-dialog state. Its desktop and Sheet containers remount across presentation modes, while InventoryTable retains selections, criteria, pagination, the group editor and the totals disclosure. The Sheet waits for a valid measurement when a retained inventory becomes active again. Mode changes defer while an existing business overlay is open; its queue opener is remembered by semantic identity. Scroll restoration is independent from focus restoration. A missing or unavailable action falls back to the heading. Closing presentation becomes inert immediately, including the retained Sheet exit-animation DOM. Queue opening is not included in the business modal guard.

The first queue candidate passed the four affected existing business suites, 54/54. These tests preserve the real InventoryTable callbacks but stub the new presentation boundary; they do not validate Radix, DOM focus or layout. The independent controlled scroll probe initially exposed a missing restore on the no-focus-key desktop path. That path was corrected and the seven scroll checks passed, including restoration without focus calls. The closing-interaction follow-up passed its separate 18-check probe. Those controlled probes and successive candidates are overlapping evidence and are not a combined total.

The first queue fixture's real-browser geometry at 1374 by 1242 was 1039 + 12 + 52px when closed and 807 + 16 + 280px when open. Records and queue both started at y=171.078px, closing the reported high-screen positioning problem. At 320px the horizontal entry was 277 by 44px and records retained their full 277px width without document overflow. Cross-size checks retained selected records and the totals disclosure. A nested-detail check found that delayed mode switching returned focus to the queue heading instead of its still-valid BAT-001 opener. The latest candidate snapshots the semantic opener when a mode change is deferred, giving it priority over interim automatic focus. A separate 320px Shift+Tab loop exposed a summary focused below the scrollable body: ordinary focus capture now applies the same body-only nearest visibility correction as cross-mode restoration. The queue-3 fixture closed the Tab-loop visibility defect but still reproduced the nested opener failure, and exposed rapid reopen leaving focus on its hidden background entry. These remained open until queue-4 verification.

The queue-3 candidate passed TypeScript checking, scoped ESLint and production build. Those engineering passes did not override its remaining browser failures. The existing chunk-size warning remains. No source push, hosted deployment, native-device acceptance or new workload/performance claim is part of this revision.
#### Queue-4 completion evidence

The final nested-focus fix is in the shared overlay fallback: when its original opener is unavailable, it preserves an already connected, visible, enabled focused control instead of replacing that focus with the workspace. Native hidden/inert content, disabled controls, focus guards, absent rectangles and hidden visibility are rejected. Temporary aria-hidden left by an unmounting Radix layer does not invalidate a visible replacement control. The original opener, explicit caller, workspace-navigation and active-dialog priorities remain unchanged. This prevents the old detail callback from overriding the new docked battery action.

A retained Sheet can reopen before Presence unmounts, so opening now also performs a guarded layout/RAF focus check instead of depending only on onOpenAutoFocus. Its movement uses reversible CSS transform/opacity transitions. A separate inert lifecycle animation retains the closing DOM for Radix Presence; closed controls immediately remain inert and non-interactive. Reduced motion removes the transitions and the existing global rule shortens lifecycle animations.

The final isolated preview is `work/qa/api-4Jd9Cb`, served for implementation review at `http://queue-implementation.localhost:52566` and independent visual review at `http://queue-audit.localhost:52566`. It uses a fresh fictional local database. The original user previews remain available with their existing data. No checkout, return or other business write was submitted during these queue verification actions.

The implementation chat verified these real-browser outcomes against queue-4:

- At 1280 by 720, six selected records and open totals survived opening BAT-001 details, resizing to 1440 by 720 and closing details. Focus returned to `Open selected BAT-001`, at y=315.625–359.625; the mode became docked and the scroll lock cleared.
- At 320 by 800, Shift+Tab from Collapse looped to the totals summary at y=719.078–775.078, inside the body at y=82–787, with scrollTop 308.
- During an Escape close, the retained pane was closed and inert while focus was on the entry. Immediately pressing Enter reopened it with focus inside the queue, no hidden/inert/aria-hidden ancestor, one expected modal scroll lock, and all six selections plus open totals retained. The settled transform was zero. This verifies the sampled interaction and final state; it is not a frame-rate benchmark.
- Opening from closed state at 1374 by 1242 produced records and queue at the same y=171.078, with 807px records, a 16px gap and a 280px queue. The implementation tab was returned to the default viewport and an empty, closed queue for handoff.
- Browser warnings and errors were empty in the recorded implementation run.

At a near-threshold viewport, an already-open modal can measure a narrower workbench because its scroll-lock compensation coexists with the page's stable scrollbar gutter. Mode selection uses that actual workbench width, not a fixed viewport breakpoint. In the recorded resize from narrow to 1374px, the open modal's workbench measured 1088px and remained a drawer; once closed it measured 1103px and the next opening was docked. Selection and opening preference remained intact.

Evidence images: `work/qa/frontend-visual/queue-4-nested-focus-1440.png`, `queue-4-rapid-reopen-320.png` and `queue-4-final-expanded-1374.png`.

The independent visual auditor repeated all three targeted focus paths on the same frozen fixture and closed EDGE-F01, EDGE-F02 and EDGE-F03. The final high-screen check independently reproduced the 1039 + 12 + 52px closed layout and 807 + 16 + 280px expanded layout, with both expanded tops at y=171.078. A sampled desktop close/open/close reversal settled closed and inert with focus on the entry. The independent tab was restored to no selections, no filters, closed totals and a closed queue; its console was empty. Evidence: `work/qa/frontend-visual/edge-3-nested-focus-1440.jpg`, `edge-3-shifttab-summary-320.jpg`, `edge-3-rapid-reopen-320.jpg`, `edge-3-final-expanded-1374.jpg` and `edge-3-final-collapsed-1374.jpg`. These checks establish the recorded geometry and interaction outcomes, not an exhaustive browser or performance result.

Final TypeScript checking, ESLint over all changed TSX/hook sources, scoped whitespace checks and the final serial production build completed successfully against the anchors below. The preview uses that final build. The existing large-chunk build warning remains; no loading-performance improvement is claimed. This closes the queue increment in its reviewed scope without a Git push or hosted deployment.

Independent functional evidence remains scoped: the unchanged four business suites passed 54/54 at their frozen queue snapshot; the final shared-focus delta passed 31/31. A retained-pane model reproduced the former rapid-reopen failure (8/9) and passed the final version (9/9). Controlled focus/scroll checks do not replace browser verification. The final private mobile copy synchronized 135 shared files and built successfully; all 48 input files remained stable and the main generated mobile manifest was unchanged. No physical-device/NFC or native release claim follows from that compatibility build.

Queue-4 product anchors (SHA-256):

| Source | SHA-256 |
| --- | --- |
| `components/inventory/review-queue-surface.tsx` | `51e16a92b9fd77a51aecf6a9a0d50ebe88d9793c2832f2e8b267708524ebde19` |
| `components/inventory/inventory-table.module.css` | `246caea1b2025742b69766262fc143a3f0754560de0c0e5b25fafcd0897c918e` |
| `hooks/use-overlay-focus.ts` | `839df494437a5c591641820c24a71107a4ee28a5211991a5c6d43d688e9987bd` |
| `components/inventory/inventory-table.tsx` | `7eb4ddcfd0bc359d76cd46d8590023153212f252a82acf0373206e8f2b39b6bb` |
| `components/ui/sheet.tsx` | `9ed82547fb5d3fe8698cf5ac986740dba78947f2e7259fbdd08713b47b997ac1` |
| `app/inventory-app.tsx` | `1a9937e3ac1f94f513a90abeb9b8f1a33acccc0dfa1651756e79f0cfe6ef0969` |
| `components/inventory/teaching-groups-workspace.tsx` | `bb19d9d746fdc99857bd2da36cc6e30cd708f7352966c4825aeb3739ad7ae5e9` |
