# Frontend visual and interaction audit

## Completed right-edge queue iteration

After reviewing the delivered preview, the user confirmed a further layout change. Review queue must become a right-edge auxiliary work area, aligned with the main workspace when expanded, with appropriate available height and internal scrolling. Its default collapsed entry or narrow rail must release the former full-column reservation while keeping the count, necessary warnings and an accessible expansion control discoverable. Narrow screens need a suitable drawer. Hover and focus increase material clarity without opening the queue.

The user's tall-viewport screenshot, approximately 1374 by 1242, exposed the previous bottom anchoring: the records started near y=175 while the empty expanded queue started near y=737, despite the full reserved column. The prior 720 px-high visual checks did not expose this composition problem. Tall desktop, compact desktop and narrow-screen checks were added. This local iteration is now complete for the recorded scenarios, with EDGE-F01 through EDGE-F03 repaired and independently retested. Prior evidence below remains versioned; this is not full accessibility qualification, measured device performance or proven Apple parity.

The delivered previews at ports 56675 and 59866 may contain user activity and must not be reset or stopped by this work. Further checks use new isolated fixtures and serialized browser ownership.

The final implementation uses the complete workbench width: at 1100 px or more, a 52 px rail can expand into a 280 px sticky second column with a 16 px gap, retaining at least 804 px for records. Below that threshold the same queue uses a modal drawer. At viewport widths of 767 px and below, the compact entry sits above full-width records. The presentation container may remount between modes; business state remains in the stable parent, and totals, scroll position and meaningful focus are explicitly preserved. Mode changes are deferred while a nested business dialog is active. A hidden inventory releases its drawer and avoids returning focus to hidden controls.

This iteration used a fresh hostname, `queue-audit.localhost`, because session cookies are host-specific rather than port-specific and `audit.localhost:56675` was already a delivered user preview. Recorded scenarios cover tall desktop empty and selected queues, compact desktop table width, drawer keyboard isolation and nested-dialog return, rapid reversal, resize continuity and outside-filter selection. Compact warning semantics also received source/controlled review; not every warning combination was produced in a real browser. Measured outcomes below are tied to frozen builds.

### Right-edge preview 1

This candidate is frozen in `work/qa/api-nl4kQf`, port 59697. The new narrow-screen design places a 44 px horizontal queue entry above full-width records at 767 px and below; the larger layout retains the narrow right rail. Browser interaction is serialized. The viewport override initially affected a different selected tab, so those attempted tall-screen captures were excluded and replaced after explicitly selecting the new audit tab. Actual `innerWidth` and `innerHeight` are recorded with geometry.

- At 1374 by 1242, the collapsed grid is 1039 px of records, a 12 px gap and a 52 px rail. Expanded geometry is 807 px, a 16 px gap and a 280 px queue. Both records and queue begin at y=171.078125; the empty expanded queue ends at y=668.46875. The previous bottom anchoring and large blank region above the queue are resolved. Evidence: `edge-1-collapsed-1374.jpg` and `edge-1-open-empty-1374.jpg`.
- Selecting all six fixture batteries and opening Active scope totals survives a change to the 1280 by 720 drawer layout. The queue is a dialog at y=12 to 708 with background accessibility isolation and body scroll locking. The totals control is focused at y=639.078125 to 695.078125 and hit testing succeeds. A later 390 by 844 transition preserves Download selected focus at y=481.78125 to 525.78125, with the six selections and open totals intact. These observations concern state continuity and geometry, not frame delivery.
- At 320 by 800, the collapsed horizontal entry is 277 by 44 px and the records also occupy 277 px. The document has no horizontal overflow. The cards retain their labelled fields. Evidence: `edge-1-collapsed-320.jpg`. Searching BAT-002 leaves all six selected, with five outside the current filters. The collapsed entry exposes six visually and the outside-filter detail through its accessible description; the expanded heading exposes the outside-filter count visually.
- In the 320 px drawer, Download selected opens a configuration dialog showing the complete six-record selection across filters; Cancel restores Download selected. Forward Tab from the final summary wraps to Collapse, and reverse Tab wraps back without entering the background. Backdrop dismissal and Escape return to the entry after the exit settles.
- **EDGE-F01 open:** open BAT-001 details from the 1280 px drawer, resize to 1440 by 720 while details remain open, then close details. Mode switching is correctly deferred and selection/totals survive, but focus returns to the queue heading instead of the still-valid Open selected BAT-001 control. This is an observed focus-continuity defect, not lost business state. The implementer is retaining the nested opener's semantic identity across the deferred mode switch.
- **EDGE-F02 open:** at 320 by 800 with six selections, open totals and a BAT-002 filter, reverse Tab from Collapse reaches the final summary but leaves it at y=880.078125 to 936.078125, beyond the queue body's y=82 to 787 clipping region. It is not hit-testable. Evidence: `edge-1-shifttab-summary-320-fail.jpg`. Ordinary queue focus needs the same bounded internal reveal used for mode-transfer focus.
- At 1440 px, navigating from an open six-record queue to Teaching groups releases dialog and scroll locks. Resizing to 390 px and using Back to previous page restores the open queue, six selections and open totals. Browser warning/error logs are empty in this session.

The functional auditor separately identified a source-confirmed interactive exit window and a controlled scroll-restoration branch failure. Their corrections, the two observed focus defects and activation-time mode measurement require a later frozen candidate. No business mutation was submitted by these visual checks; the new fixture remains six in store and zero in use. Previous delivery previews remain untouched.

### Right-edge preview 2

The next visual candidate is frozen in `work/qa/api-2dwWk1`, port 52401, corresponding to implementation queue-3 and functional docked-queue-6. The ReviewQueueSurface source anchor is `34ae636d0aebf232ea50a916f70969519345ede89e208cd5677340f042a1e310`. It includes immediate inert exit content, independent scroll restoration, activation-time mode measurement, deferred focus capture and ordinary focus reveal.

- **EDGE-F02 repaired:** replaying the same 320 by 800 reverse-Tab scenario now positions the summary at y=719.078125 to 775.078125 within the body's y=82 to 787. Internal scroll is 308 px, the entire control is visible and centre hit testing succeeds. Evidence: `edge-2-shifttab-summary-320.jpg`.
- **EDGE-F01 remains open:** the 1280 px drawer / BAT-001 detail / 1440 by 720 resize / Close sequence still finishes on Review queue 6 rather than Open selected BAT-001. Selection, totals and released locks remain correct. Despite its neutral filename, `edge-2-nested-focus-1440.jpg` records this failed return-target check.
- **EDGE-F03 open:** Escape from the queue summary begins closing and restores the launcher. An immediate Enter on that launcher reopens the existing drawer before its exit has unmounted. The recorded close has `data-state=closed`, `aria-hidden=true` and `pointer-events=none`. The settled reopened queue is open, has no inert attribute and has the expected scroll lock, but active focus remains on the launcher outside the dialog, inside an accessibility-hidden background ancestor. Intermediate transforms were sampled, but they do not establish continuous motion reversal. This requires explicit reopen focus handling; the implementer is also investigating whether the CSS animation restarts from its endpoint.

These remaining failures prevent closure of this increment. The implementer has temporary exclusive browser ownership for diagnosis; visual-auditor browser work is paused to avoid concurrent target or viewport changes.

### Final right-edge preview 3

The delivery candidate is frozen in `work/qa/api-4Jd9Cb`, port 52566, corresponding to implementation queue-4 and functional docked-queue-7. The implementer first reproduced and retested the failures, then explicitly handed browser ownership back for an independent run. The delivery URL is `http://queue-audit.localhost:52566/`.

| Product source | SHA-256 |
| --- | --- |
| `components/inventory/review-queue-surface.tsx` | `51e16a92b9fd77a51aecf6a9a0d50ebe88d9793c2832f2e8b267708524ebde19` |
| `components/inventory/inventory-table.module.css` | `246caea1b2025742b69766262fc143a3f0754560de0c0e5b25fafcd0897c918e` |
| `hooks/use-overlay-focus.ts` | `839df494437a5c591641820c24a71107a4ee28a5211991a5c6d43d688e9987bd` |

- **EDGE-F01 repaired:** the same 1280 px drawer / six selections / open totals / BAT-001 details / 1440 by 720 resize / Close sequence returns to Open selected BAT-001 at y=315.625 to 359.625. Centre hit testing succeeds; the queue is docked, the body lock is released and the six selections plus open totals remain. Evidence: `edge-3-nested-focus-1440.jpg`.
- **EDGE-F02 remains repaired:** at 320 by 800, the original filtered-selection and download-cancel sequence followed by reverse Tab gives the same fully visible summary at y=719.078125 to 775.078125, inside the body's y=82 to 787, with scrollTop 308 and successful hit testing. Evidence: `edge-3-shifttab-summary-320.jpg`.
- **EDGE-F03 repaired:** the immediate Escape / Enter sequence is observed while the retained drawer is still closing, with inert=true, aria-hidden=true and pointer-events=none. Reopening places focus on Review queue 6 inside the pane. The settled state has zero translation, no hidden/inert/aria-hidden ancestor on focus, the expected single modal scroll lock, six selections and open totals. Evidence: `edge-3-rapid-reopen-320.jpg`. Computed movement uses transform/opacity transitions; sampled intermediate values support the interrupted interaction and correct end state, not a frame-rate or perceptual-smoothness benchmark.
- At 1374 by 1242, the final collapsed grid remains 1039 px plus a 12 px gap and 52 px rail. Expansion produces 807 px plus a 16 px gap and 280 px queue. Both surfaces start at y=171.078125; the empty queue ends at y=668.46875. Its resting background is white at 88% alpha, while text/container opacity remains 1. Evidence: `edge-3-final-collapsed-1374.jpg` and `edge-3-final-expanded-1374.jpg`.
- A rapid desktop close / open / close sequence records an intermediate grid of 1018.44 px and 72.2188 px while the final requested state is already closed, inert and aria-hidden, with focus on the launcher. The settled layout returns the released space to records. No selection or business request is tied to this animation.
- The delivery tab is restored to zero selected, no ordinary filters, collapsed totals and a collapsed queue, with the temporary viewport override reset. The fictional data remains six in store and zero in use. Recorded browser warnings/errors are empty. The delivered user previews at ports 56675 and 59866 retain their existing services and data.

The mode threshold uses actual workbench width. Near the threshold, scroll-lock compensation and the stable scrollbar gutter can keep an already-open drawer below 1100 px even at a 1374 px viewport; closing releases that compensation and the next opening can dock. This is documented behavior, rather than a claim that every 1374 px window must always display the same mode.

Independent functional closure covers the unchanged 54-case business suites, the final 31-case shared-focus increment, the 9-case retained-pane lifecycle model and the private 135-file shared-mobile build, with source versions and overlapping checks kept separate in [the functional audit](frontend-refactor-functional-audit.md). The existing build chunk-size warning remains. Actual OS-level preference switching, full browser/accessibility coverage, physical iPhone 13 performance and the staff comparison study remain outstanding qualification work. No Git push or hosted deployment was performed.

## Completed material and control polish

The user accepted the overall composition, translucent direction and Review queue, then requested a focused application-wide polish pass. The accepted structure stays in place. The new requirements supersede the earlier decision to retain the yellow identity mark:

- Remove legacy decorative/brand yellow, including icons, station accents and favicon; keep intentional semantic distinctions for genuine warnings and operational states.
- Replace the prominent blue canvas gradients with a near-white or very light neutral background. Retain depth through spacing, boundaries, shadows and restrained translucent surfaces.
- Apply consistent geometry, icon alignment and visual treatment to controls with equivalent roles across all workspaces, rather than fixing only the example screenshots.
- Keep glass surfaces readable at rest, increasing local surface clarity on hover and focus-within. Touch use and opaque/reduced-effects fallbacks must remain usable without hover.
- Start Review queue in a compact collapsed presentation at every breakpoint. Keep its title, selection count, expansion control and necessary notices discoverable; collapsing must release layout space. Preserve the user's current expansion choice, selected records, drafts and unresolved requests. Selection changes must not repeatedly force expansion.
- Validate actual motion and interaction: queue reversal and layout continuity, button states, navigation and overlay focus relationships. Evaluate and repair the known in-flight reduced-motion preference gap where feasible. Animation never authorizes submission, creates success or delays authoritative business state.

The local visual polish pass is complete for the recorded scenarios below. POL-F01, POL-F02 and POL-V01 were repaired and retested; this is not full quality qualification or proven Apple parity. Final functional and shared-client evidence is recorded separately in [the functional audit](frontend-refactor-functional-audit.md). The existing preview at port 59866 is being used by the user and its records remain untouched. New checks use fresh isolated fixtures. Earlier engineering evidence remains tied to its recorded versions.

### Polish preview 1

The production build is frozen in `work/qa/api-RNudgx`, port 52025. The visual auditor uses `audit.localhost`; the implementer uses `localhost`. The user preview remains on `127.0.0.1:59866`. Host separation avoids overwriting its host-only session cookie. Screenshot names start with `polish-1-`.

- At 1280 by 720, Review queue starts closed with a 280 by 70 px summary. The records area occupies 1009 px; expansion changes it to 711 px plus an 18 px gap and a 280 px queue. Closing restores the full width. The first View control is y=346.8125 in this build; previous first-row numbers remain historical.
- Selecting BAT-001 does not open the queue. Searching BAT-002 preserves the selection and exposes the outside-filter count while collapsed. Explicit expansion and resizing to 390 px preserve the user's open choice.
- Three consecutive Enter activations reverse the running disclosure. An intermediate close capture shows height 99.3555 px and a 21.2344 px remaining grid track; the settled close is height 0, hidden, inert and aria-hidden=true with a zero-width second track. Reversing again settles open with height auto, no hidden/inert and aria-hidden=false. Focus stays on the toggle. These observations verify interruption and end states, not frame rate or latency percentiles.
- Actual pointer placement over the top bar gives hover=true and focus-within=false, with a 98% white background. Moving the pointer to the records area restores 88%. Keyboard focus within the top bar, with hover=false, produces 98%. Container opacity remains 1 and backdrop blur is 16 px. The canvas is rgb(245,246,248). A static sRGB calculation for muted text #586477 on 88% white over black is approximately 4.56:1; this is a token calculation, not a complete contrast audit.
- At 390 by 844, Shift+Tab from the expanded queue reaches Batteries per page at y=119.484375 to 163.484375; the queue begins at 218.328125. The control is hit-testable at its centre and the queue remains open.
- **POL-F01 open:** at 320 by 800, a long Search chip is 111.5 px high. On keyboard focus, it moves to y=119.875 to 231.375, while the expanded queue begins at 206. The lower 25.375 px remains obscured. The top bar ends at 107.890625. The exact search is `Robotics battery pack stored in Willis Annexe for teaching group laboratory equipment comparison with portable battery records and long descriptive labels`. Evidence: `polish-1-long-chip-focus-320-fail.jpg`. A focus-aware queue height adjustment is being implemented; it is not present in this frozen preview.
- **POL-F02 open:** with the queue open and Batteries per page focused at 1280 by 720, resizing to 390 by 844 leaves that same focused control at y=1649.90625 to 1693.90625, outside the viewport, with scrollY=563. A focus event alone does not cover reflow after resizing. This is an observed acceptance gap, not a proven newly introduced regression.
- Activity history, Recurring tasks, Directories and Teaching groups receive desktop visual sampling. Their source/data distinctions and empty states remain visible. **POL-V01 open:** the Directories toolbar has 44 px Search and Clear filters but a 48 px idle Download filtered list receipt control; the implementer will align equivalent toolbar roles without weakening pending/confirmed feedback.
- Closing a detail opened from the queue restores Open selected BAT-001. Inventory to Teaching groups to Back to previous page retains BAT-001 and the expanded queue. This statement is limited to that mounted navigation path, not arbitrary navigation through every workspace.

The sign-in and inventory captures show the quieter palette and blue/white identity. Actual browser reduced-motion/transparency preference switching, physical iPhone performance and complete accessibility conformance remain unverified; independent controlled motion tests are reported separately by the functional auditor.

### Polish preview 2

The next production build is frozen in `work/qa/api-tV6pEr`, port 50099. UI work is serialized between the implementer and visual auditor after concurrent sessions produced inconsistent target observations. Those ambiguous observations are not treated as product failures or passing evidence. A fresh controlled reload on the auditor's host confirms the queue is initially closed at 390 px.

- **POL-F01 repaired:** the same 111.5 px Search chip occupies y=119.08 to 230.58 in the captured sample. The queue begins at 243.39, leaving more than 12 px clearance. Hit tests near both top and bottom resolve to the chip; the queue stays expanded. Evidence: `polish-2-long-chip-focus-320.jpg`.
- **POL-V01 repaired:** the Directories Search, Clear filters and Download filtered list controls each measure 44 px high with a 10 px radius. An actual download creates the two-record XLSX fixture. The confirmed receipt remains 44 px high and explicitly says the file is ready and the browser was asked to save it. Evidence: `polish-2-directories-export-desktop.jpg`. No warning/error console entries are observed.
- **POL-F02 remains open:** resize handling brings the focused page-size control back inside the viewport but its stable y=284.90625 to 328.90625 still overlaps the queue, whose top is 218.328125. The page has scrollY=1928 and document height 3307. The likely cause is temporary scroll clamping while narrow-layout bottom padding transitions; this explanation is an inference, while the final occlusion is observed. The next patch rechecks focus after the workbench's own relevant layout transitions. Evidence: `polish-2-resize-focus-390-fail.jpg`.

Mobile sign-in and the controlled initial collapsed inventory are recorded in `polish-2-signin-390.jpg` and `polish-2-inventory-collapsed-390.jpg`. These are browser viewport checks, not physical iPhone acceptance.

### Polish preview 3

This visual candidate is frozen in `work/qa/api-ZYItJ2`, port 62371. Its tab and the prior user preview remain available. Intermediate previews at ports 52025 and 50099 were stopped after the checks, while their files and captures were retained.

- **POL-F02 repaired:** replaying the original 1280 by 720 to 390 by 844 sequence now leaves Batteries per page at y=118.90625 to 162.90625, above the queue at y=218.328125. Its centre resolves to the focused button, focus identity and selection remain unchanged, and the queue stays open. The settled page scroll is 2094 px. At 390 by 600, the same target remains visible while the queue begins at y=193. Evidence: `polish-3-resize-focus-390.jpg`.
- The added recheck runs after the workbench's own layout transition, resolving the earlier temporary scroll-clamp case without changing the chosen open state. Business mutations and confirmation remain outside the animation lifecycle.
- The final desktop capture is `polish-3-inventory-desktop.jpg`: neutral canvas, consistent blue/white identity, full-width records and a compact selected-count queue. Browser warning/error logs are empty in this recorded session. Temporary viewport overrides were reset.

No hosted release was published, and the user's prior preview data was not reset. Remaining qualification includes the complete browser/accessibility matrix, real iPhone 13 testing, measured performance and the staff comparison study described in [the quality standard](frontend-quality-standard-draft.md). Controlled media-preference tests establish the tested logic; they do not substitute for actual OS-level preference switching or measured animation smoothness on physical devices.

### Final polish preview 4

The delivery build is frozen in `work/qa/api-hLyye5`, port 56675, and is available at `http://audit.localhost:56675/`. The final inventory component SHA-256 is `cbb4c47edf6f13ed71cd20028df7e543f6e7c1dec5f0992ab34f54840692125e`, matching the functional auditor's polish-5 source anchor. These two audit sequences use different numbering; they refer here to the same source.

The only final product delta adds the same bounded focus recheck for the workbench's own relevant `transitioncancel` events. This guards cancellation of a layout transition when reduced motion is enabled. It is a controlled logic check, not an OS-level preference test in the real browser. Earlier visual results remain tied to their snapshots and are not counted again.

Final smoke checks pass normal sign-in, initial queue closed with count zero and grid tracks `1009px 0px`, and empty browser warning/error logs. Repeating the one-selected-record resize case gives the same visible page-size control at y=118.90625 to 162.90625, with the queue starting at 218.328125; centre hit testing succeeds and the queue remains open. The final default desktop image is `polish-4-inventory-desktop.jpg`. The browser viewport override is reset and the delivery tab is retained. No further product change is included in this audit.

## Design direction correction

The user reviewed the initial outcome and found the overall change too close to the original page: improved styling and behavior did not provide the expected product-level redesign. The fourth build is therefore retained as a stable engineering reference, not accepted as completion of the design goal. Its functional protections, recovery and accessibility repairs remain valuable and must be preserved.

Work continues with a substantial redesign of sign-in and the core inventory workbench: overall composition, navigation, information hierarchy, data presentation and task organization. The visual auditor must first assess meaningful improvement to the complete task experience. Local checks and passing regression tests cannot substitute for that design review. A coherent direction will then extend across the remaining workspaces.

### Structural review contract

The accepted implementation direction is a compact inventory context and control area, a dominant records surface, and a review queue that keeps selection and the next supported actions visible. Desktop uses a secondary task area; narrow screens reorganize the same queue without losing filtered-out selections or obscuring records. Existing View details remain separate from selection and retain their current state lifetime. Teaching groups and Intake & removal remain primary navigation destinations, the three status tabs remain intact, and ordinary criteria stay in one Filter panel. Sign-in receives a distinct composition with product context and a direct form.

The user explicitly requires perceptible restrained translucency. Navigation, top controls, temporary panels and sign-in must demonstrate deliberate background transmission, blur, boundaries and layering in the actual rendered page. Data, prose and critical forms retain stable readable surfaces. A CSS declaration alone is insufficient evidence; the review must inspect real overlapping content, control/focus visibility, pointer access, scroll behavior and an opaque fallback. Smoothness and contrast claims must remain limited to measurements actually performed.

Initial layout budgets are a first record beginning within approximately 280 CSS px at 1280 by 720, and 360 CSS px at 390 by 844, using the same six-record dataset. These are proposed design targets, not a reason to remove required context or a measured claim of usability. Review the complete task organization first, then tune these budgets against required information and observed behavior. Historical screenshot names beginning with `final-` refer only to the fourth engineering reference and are not the final accepted design.

### Structural preview 1

The new composition is frozen in isolated preview `work/qa/api-y7woUL`. Evidence uses `structural-1-` filenames. The direction now makes a substantial structural change: split sign-in, a consolidated inventory context bar, a dominant records area and a separate review queue. This direction is accepted for further implementation, with the following defects and remaining validation still open.

- At 1280 by 720, approximately four complete records are visible, with the first View control at y=344.8125, compared with y=480.3125 in the fourth engineering reference. At 390 by 844 it begins at y=481.5, compared with y=636.03125. Narrow title/registration and New arrivals still use excessive vertical space; further consolidation is requested without removing their functions.
- Sign-in uses distinct desktop identity and form regions, then a compact identity header above the form on narrow screens. At 390 by 844, inputs remain 48 px high with 16 px text, and the ordinary page fits. A real incorrect-password response focuses Password; valid isolated credentials enter the inventory.
- Selecting BAT-001, searching BAT-002 and collapsing Filter retains BAT-001 in the review queue with its concrete ID and the count of one selection outside current filters. The independent filter and selection task is clearer than the former selection strip. No new business mutation is needed to demonstrate this improvement.
- **A07 fail:** at 390 by 844, expand Review queue and press Shift+Tab from Hide queue. Focus reaches Batteries per page at y=399.984375 to 443.984375, but the fixed queue spans y=222.328125 to 830 and completely covers it. Scrolling does not resolve the overlap. This new structural defect must be repaired while preserving selection and external focus; see `structural-1-queue-obscured-focus-390.jpg`.
- Translucent control layers are visibly present. The rendered top bar uses `rgba(240, 247, 255, 0.62)` with `saturate(1.4) blur(20px)`; the identity text is dark. These observations establish implementation and appearance only, not all-background contrast or GPU/frame-rate acceptance. The data surface remains opaque.

The six battery IDs and task sequence are comparable across the isolated previews. Account-owned fixture fields can differ because each preview seeds fresh local accounts; those values are not evidence of a changed business rule.

### Structural previews 2 and 3

Preview 2 is `work/qa/api-EnZcjZ`; preview 3 is `work/qa/api-qtZwDx`. Their screenshot prefixes are `structural-2-` and `structural-3-`. These browser checks concern the frozen builds, not a moving development server.

- The narrow registration action shares the title row and New arrivals joins the filter tools, preserving its separate meaning from the three status tabs. At 390 by 844, the first View control is y=386, compared with y=935.375 in the original baseline. This is a substantial measured improvement; the approximate 360 px design budget is not met and is not achieved by removing required information. Desktop remains approximately four complete records with first View y=344.8125; the 280 px proposed budget likewise remains unmet.
- **A07 / STR-F01 repaired in preview 2:** Shift+Tab from Hide queue transfers focus to Batteries per page at y=408.484375 to 452.484375. The queue collapses to y=741 to 830, leaving that control visible; one selection and its filtered-out count remain. Opening a selected record and closing its detail sheet restores Open selected BAT-001 while the queue stays open. Opening Download selected, cancelling, then narrowing from desktop to 390 px keeps the queue expanded and the download control focused and unobscured at its centre.
- **STR-F02 repaired in preview 3:** after focusing the narrow queue toggle and returning to 1280 px, focus transfers to the visible Review queue heading at y=208.3125 to 233.5 instead of BODY. No selection change occurs.
- **STR-F03 repaired in preview 3:** Clear filters and removal of the last Search chip both restore focus to the persistent Filter control while selected BAT-001 remains checked. The newly hidden empty narrow Applied filters region introduced the Clear case; the disappearing last-chip case was an older potential gap and is not attributed exclusively to this refactor.
- **Real isolated transaction checks in preview 3:** cancelling the queue's checkout review leaves six in store and zero in use and restores Check out selected. Explicitly confirming BAT-001 produces five in store and one in use, with API Staff as current holder. Its reviewed return restores six in store and zero in use. Selection remains checked; successful completion focuses the workspace. These checks do not substitute for the functional audit's fault and recovery cases.
- Teaching groups remains a primary navigation destination. Visiting it removes the visible inventory queue; Back to previous page restores the selected BAT-001 and focuses the inventory workspace.
- At 320 px, the source name, account identity, status tabs and queue heading are readable, with no document horizontal overflow. However the three filter tools total about 258 px in a 251 px content area, pushing Download to its own nearly empty line. This visual defect remains open for the final CSS-only adjustment; a lack of document overflow alone does not establish a polished layout.
- The implementation chat independently reported a sticky intake header obscuring First-use mode during keyboard navigation at 320 px. Its repair and related station checks must be recorded before closure. This is separate from the inventory queue defect.

Scroll and export-overlay screenshots capture actual composition in preview 2. They show layered controls and stable data/forms, but do not measure animation frame rates or every possible background contrast. The current browser tooling does not provide an OS-level reduced-transparency or physical iPhone test; source fallback declarations are not reported as a completed device test.

### Final local engineering review

Structural preview 4 is `work/qa/api-UzVTXy`; the final structural preview 5 is `work/qa/api-E7iLTV`. The final increment changes only two CSS layouts; the functional audit separately verifies source hashes rather than rerunning unchanged business suites.

- **320 px tools repaired:** Filter, New arrivals and Download now share y=292.484375 to 336.484375, each 44 px high. Their measured widths are 79.671875, 116.703125 and 44 px. Document width is 305 px at a 320 px viewport. Identity, source and the compact Review control remain readable. See `structural-4-inventory-320.jpg`.
- **STR-F04 repaired:** the implementation chat tested intake, removal and scanning on the frozen fourth preview. Their focused controls begin below the measured station bar and pass centre-point hit checks: intake First-use mode y=384–428 with bar bottom 371.8125; removal kind y=390.156–434.156 with bar bottom 377.75; scan tag y=398.718–444.718 with bar bottom 379.5. The top bar is y=0–107; station bars start at 115. This auditor independently inspected the three `structural-4-admin-*-focus-320.jpg` screenshots. The functional audit independently exercises the actual focus helper, its exclusions and cleanup. No business write was required for these checks.
- **Narrow scan input repaired in preview 5:** the implementation chat measured a 207 by 46 px tag input at y=391.718–437.718, below the station bar at 379.5. `DEMO-TAG-001` is fully visible. Add tag is 207 by 44 px beneath it, and both centre points hit their intended controls. This auditor independently inspected `structural-5-admin-scan-focus-320.jpg`. The test text was cleared and the station exited without adding a tag to a queue or writing a business record.
- **Desktop applied criteria repaired in preview 5:** the active Applied filters region occupies a complete 701 by 34 px second row. Search: BAT-002 is a single-line chip and Clear filters remains in the same row; Filter, New arrivals, result count and Download remain in the first row. The queue still shows selected BAT-001 and one selection outside the current filters. See `structural-5-filtered-selection-desktop.jpg`.
- The final staff preview returns to six visible fictional records, no active filter, no selection and no dialog. Its observed browser warning/error log is empty. Temporary viewport overrides and intermediate preview services are removed; the final local preview remains available.

The local engineering iteration is ready for user review. It substantially changes sign-in and inventory composition and applies shared visual, material, motion and focus treatment across the application. This is not full acceptance of the proposed Apple-comparison standard. The first-record design budgets above remain unmet, and physical iPhone 13/Safari testing, measured latency and frame stability, complete accessibility evaluation and the planned staff study remain outstanding. The short running-animation reduced-motion preference limitation described below also remains. Long station instructions still occupy substantial space at 320 px; the focus repair does not demonstrate optimal long-form task efficiency.

## Scope and evidence

This independent audit accompanies the local web frontend refactor started on 10 October 2026. The implementation chat owns product code; the functional audit owns business regression checks. The quality proposal in `frontend-quality-standard-draft.md` supplies the intended standard, not a claim that the interface has achieved it.

The comparison baseline includes the existing working-tree changes, rather than Git HEAD. A production build completed successfully before refactoring and was copied by `scripts/isolated-preview.mjs` into a private preview directory. The preview uses isolated local fictional accounts and records. No hosted data is involved.

Baseline screenshots are retained locally under ignored `work/qa/frontend-visual/`: `before-signin.jpg`, `before-inventory-desktop.jpg`, `before-inventory-390.jpg`, and `before-detail-390.jpg`. Desktop evidence uses a 1280 by 720 viewport; narrow evidence uses 390 by 844 CSS pixels in the desktop browser. This is responsive-layout evidence, not an iPhone Safari or physical-device performance measurement.

## Confirmed baseline findings

| ID | Observation | Required follow-up |
| --- | --- | --- |
| V01 | At 390 by 844 with the document scrolled to the top, the first View BAT-001 button begins at y=935.375 CSS px, below the viewport. Header, repeated context, actions, demo notice, totals, tabs and toolbars occupy the initial screen. | Reduce repeated hierarchy and control stack height while preserving all actions, scope and evidence. Compare the same data and viewport after refactoring. |
| V02 | At 1280 by 720 with the document scrolled to the top, View BAT-001 begins at y=552.28125 CSS px. Repeated workspace chrome leaves approximately two battery rows visible. | Improve the balance between context and useful data, without making controls or text too small. |
| A01 | Opening BAT-001 details focuses Refresh details. Closing via Close leaves focus on BODY after the dialog settles, instead of returning to View BAT-001. Reproduced at 390 by 844. | Restore focus to the originating control when it still exists, with a safe fallback for changed records. Preserve pending detail state. |
| A02 | At 1280 by 720, Download inventory followed by Cancel also leaves focus on BODY. | Verify shared dialog restoration, including nested dialog handoffs and navigation focus precedence. |
| R01 | Source inspection found that initial session-check failure disables credentials without a direct retry entry point. | Make session loading recoverable and clearly distinguish checking, submitting, failure and server-confirmed success. Browser and behavioral tests must verify the result. |

The narrow detail view presents responsibility, registered home, dated observation and inspection evidence separately. Those distinctions and all original operations must survive the refactor.

## Validation plan and limits

- Review sign-in at desktop and narrow sizes, field labels, error recovery, keyboard operation, immediate feedback, duplicate submission and real server-confirmed navigation.
- Review navigation, inventory selection and filters, detail opening and dismissal, explicit operation review, outcome feedback and preservation of unresolved requests.
- Check readable content, restrained glass on control surfaces, focus visibility, responsive overflow, minimum target size, reduced motion and usable fallback styles.
- Check representative shared, personal and administrator workspaces without changing real business data. Pair browser observations with the separate functional audit.
- Preserve screenshots and concrete reproduction steps for defects; retest fixes against a fresh immutable production preview.

Screenshot inspection does not establish latency percentiles, Core Web Vitals, animation frame stability, full WCAG conformance or perceptual parity with Apple. Those claims require their specified measurement procedures; the planned staff pilot and physical iPhone 13 testing remain separate evidence.

## First implementation preview

The first production build was copied into isolated preview `work/qa/api-9xlpdR`. Screenshots use the `after-1-` prefix. The source may subsequently change; the observations below apply to this immutable build.

| Check | Observed result |
| --- | --- |
| Sign-in failure and success | Incorrect password shows an actionable message and focuses Password. Correct isolated credentials enter the authenticated inventory. The primary button measures 48 CSS px high. |
| Sign-in layout | **Fail V03:** at 1280 by 720, document height is 818 px and the card extends from y=106 to y=730.453125. The normal page requires unnecessary vertical scrolling. Sent for repair. |
| Initial inventory hierarchy | First View BAT-001 begins at y=540.3125 desktop and y=780.03125 narrow, compared with y=552.28125 and y=935.375 in the baseline. Narrow overflow is absent, but useful record context remains too low. Further consolidation requested. |
| Narrow detail target | View BAT-001 measures 32 px high. Further adjustment requested to meet the proposed 44 px touch target. |
| Selection and detail | Selecting BAT-001 once selects one record. Opening details does not deselect it. Detail Close restores View BAT-001. Baseline A01 is repaired in this preview. |
| Nested export | Details → Download details → Cancel restores Download details inside the original dialog. Closing that dialog restores the original record control. |
| Filtering and export | Searching BAT-002 retains selected BAT-001 and reports one selection outside the current filters. Choosing All filtered batteries and CSV produces exactly one data row, BAT-002, with 35 columns. Done restores Download inventory. Clearing filters retains selection. |
| Explicit checkout and return | Cancel leaves six in store and zero in use. Confirming BAT-001 checkout yields five in store and one in use attributed to the authenticated fixture staff. Confirming its reviewed return restores six in store and zero in use. Selection remains intact. |
| Mobile navigation focus | **Fail A03:** selecting Recurring tasks first focuses the workspace, then the sheet's completed exit moves focus back to Expand navigation. A subsequent source fix requires browser retesting. |
| Form boundaries | **Fail A04:** the rendered Inventory select boundary is #dce3ed on white (1.292:1); Search periodic tasks uses #a4b0c1 on white (2.197:1). Required field boundaries need at least 3:1 against the adjacent surface. Decorative card separators are a separate case. |

Rendered token samples provide limited static color evidence: primary #075dcc against white is 6.093:1; muted #586477 against white is 5.993:1 and against the #f5f7fa canvas is 5.584:1; success text #286345 against #edf7f0 is 6.472:1. This does not establish contrast across every state, translucent composition or complete WCAG conformance.

These are real browser observations using disposable local data. The automated functional audit separately covers server faults, exact-request recovery and concurrency; these browser exercises did not inject network failures or establish latency percentiles.

## Second implementation preview

The next production build was frozen in `work/qa/api-yhHFSY`. The `after-2-` screenshots identify this version.

- **V03 repaired:** normal sign-in fits the 1280 by 720 viewport (document height 720; card bottom y=640.71875). It also fits a 320 by 740 viewport without horizontal overflow. Inputs retain 48 px height and 16 px text.
- **A04 repaired for measured controls:** the rendered sign-in input border is #7d899a against white, approximately 3.549:1. This is sampled evidence, not every-state conformance.
- **V01 improved:** at 390 by 844 and scrollY=0, View BAT-001 begins at y=640.03125, 295.34375 px above the baseline. Its 44 px target and the record's status are visible in the initial viewport. No document horizontal overflow is observed.
- **A03 repaired:** after choosing Recurring tasks in the narrow sidebar and waiting for its removal, focus remains on `workspace-content`; no dialog or decorative exit node remains.
- Detail Close returns focus to View BAT-001 and leaves no dialog or decorative exit node after settling. The separate controlled-DOM audit covers exit cleanup and immediate logical closure; this browser check does not quantify animation smoothness.
- **A05 open:** at 320 px, the inventory status row clips In use. The implementer independently reproduced a similar clipped Batteries tab in Manage records, and long administrator identity text overlapping Sign out.
- **A06 open against the proposed touch strengthening:** the inventory checkbox is 16 px square with a 12 px pseudo-element expansion, yielding 40 px. The adjacent View action is 44 px high and does not overlap the observed expansion. Larger equivalent row selection remains available; this is not a standalone claim of WCAG failure.
- **V02 remains open:** the desktop first record still starts at y=540.3125. Further reduction of repeated context spacing is requested while retaining readable controls.
- The implementer independently found an intake station overflow at 320 px: document width 358 px, with a long confirmation button widening its panel. Task and staff-account editor checks were usable in that inspection. These observations are attributed to the implementation chat and await final-build retesting.

## Third implementation preview

Preview `work/qa/api-qp9KZH` contains the third frozen production build. The functional audit verified that its six changed files comprise five CSS files and one additional RecordManagement class name, without business callback, permission, payload, state, recovery or mounting-identity changes.

- **V02 improved:** at 1280 by 720, scrollY=0, the first record control begins at y=480.3125, approximately 72 px above the original baseline. Three records are visible rather than approximately two.
- **A05 repaired functionally:** at 320 px all three inventory status tabs fit between x=31 and x=274. Each is approximately 78.3 px wide and at least 44 px high. In use remains clickable and shows the expected empty result; All batteries restores six records. At 390 px, inconsistent count wrapping remains a final visual refinement.
- **A06 repaired:** the inventory checkbox is 16 px with 14 px expansion on each side, making an effective 44 px square. At the observed record position its extended right edge is x=67 and the adjacent View action begins at x=69. A pointer click in the outer extension (x=65) toggles once and focuses the checkbox. Opening and closing View does not change selection.
- **A07 repaired in the implementer's browser check:** all four Manage records tabs fit a 2 by 2 layout at 320 px, each 119.5 by 44 px; Batteries can be selected.
- **A08 overlap repaired, polish pending:** the narrow administrator identity and Sign out have a 6 px gap, although the long role wraps awkwardly and makes the header 90 px tall. A final scoped style correction is planned.
- **A09 repaired in the implementer's browser check:** intake document width is 305 px at a 320 px viewport, compared with 358 px previously. The panel is 277 px wide; the long confirmation button wraps to 243 by 56 px, and the 236 by 46 px Exit control remains visible.

The implementation chat also checked Messages, Teaching groups, task creation and staff-account editors with local fixtures, opening and cancelling forms without changing accounts or permissions. An artificially long stored group name was not tested and must not be reported as a browser pass.

## Additional source findings

The independent motion review found additional baseline risks. These are source findings pending browser reproduction and retesting, not measured failures of the new build.

- Controlled Dialog and Sheet instances without a Radix Trigger have no shared opener-focus restoration. Export, movement and mobile navigation need explicit review in addition to the reproduced detail case. Selecting a new workspace from the mobile sheet must allow focus to move into that workspace.
- Several conditional mounts in `app/inventory-app.tsx` remove entire dialog components immediately on close. Their always-open children never receive `open=false`, so CSS closed-state exit animations cannot run. Any lifecycle change must retain the existing guards and pending request state.
- Runtime changes to reduced-motion preference cancel the workspace observer's animations, but the independent transition and spring helpers initially check the preference only at animation start. Existing CSS reduced-motion handling is present; this is a narrower interruption issue.
