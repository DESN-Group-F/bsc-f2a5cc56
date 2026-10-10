# Frontend quality and acceptance standard draft

Prepared 10 October 2026. This proposal defines measurable quality for the battery inventory web application and iPhone app. The delivery ambition is to meet or exceed selected Apple experiences while reducing staff workload. Passing technical checks alone does not establish that comparison.

The scope decisions below are confirmed. New numerical targets marked **Proposed** remain open for agreement before acceptance testing. No performance, accessibility, user-study or Apple-comparison result was produced by preparing this document. Existing business guards remain mandatory under [project instructions](../AGENTS.md).

## Confirmed scope

| Decision | Agreed scope |
| --- | --- |
| Web reference | Tool-oriented experiences such as iCloud web applications. Apple marketing pages provide visual references, not workflow or performance baselines. |
| Mobile reference | iPhone first; preserve room for later iPad adaptation. An iPad build declaration is not iPad acceptance. |
| First physical device | iPhone 13; the user can arrange physical-device testing. This does not yet define the oldest supported device or OS. |
| Visual direction | Restrained translucency in navigation and temporary control surfaces; stable, legible surfaces for operational data. The subsequent user review confirms a near-white or very light neutral canvas, removal of decorative yellow, and consistent controls across workspaces. Real warning semantics remain distinct. Glass is legible by default and becomes clearer on hover or focus within, with touch and opaque fallbacks. |
| Appearance | Light appearance for the first frontend quality milestone. Dark appearance is a later phase. System dark preference must not produce a partially dark interface. |
| User evaluation | Approximately 6–8 actual or prospective staff can participate in the first study. Results will be descriptive, with individual outcomes retained. |
| Development | Local research, prototypes and validation. This standard does not authorize publication, deployment or changes to hosted data. The mobile functional prototype retains its existing release boundary. |

Quality parity concerns comparable interactions on recorded devices and versions. It does not mean reproducing Apple branding, assuming every Apple design is optimal, or claiming superiority across all Apple software.

## Evidence and acceptance rules

Every requirement uses one of these evidence categories:

- **External standard:** a published criterion, with its actual scope and exceptions. WCAG AA is a conformance level, not an aesthetic score.
- **Official guidance:** Apple or browser-platform recommendations. These are not automatically mandatory App Store rules, nor measured results for Apple applications.
- **Project invariant:** an existing business or integrity requirement.
- **Proposed:** a project-specific threshold or test procedure. A supporting source may explain the mechanism without prescribing our number, percentile or sample size.

Each acceptance record must identify the requirement, build, fixture, device, OS, browser or WebView, tool version, condition, raw evidence and result. Use **Pass**, **Fail**, **Not measured**, or **Not applicable with reason**. Missing measurements never count as a pass. A pass applies to the recorded test scope.

Release review uses separate gates for integrity, accessibility, performance, visual and interaction quality, and staff outcomes. All applicable gates must pass; a visual score cannot compensate for a failed transaction or an inaccessible primary action. A conditional local engineering milestone may precede field evidence, but cannot be described as full quality acceptance or proven Apple parity.

## Existing project baseline

The web application uses React and the Vite/vinext build path with Worker/D1 services. The mobile prototype uses React/Capacitor, a synchronized client graph and native adapters. It is not a SwiftUI application. Sharing domain logic does not require identical desktop and phone layouts.

At the research baseline, the [design system](design-system.md) described the yellow-and-ink identity, semantic status colors, keyboard focus and static contrast checks. Its motion/module description had drifted from source: [global imports](../app/globals.css) included additional workspace and motion modules, and [motion implementation](../lib/client/workspace-motion.ts) included row entry and list reordering. The authorized local refactor reconciles the documentation with implementation. The earlier choice to retain a yellow battery mark was superseded by the user's subsequent review: remove decorative yellow from the identity, favicon, ordinary notices and station borders, reduce blue background gradients, and retain blue for intentional actions, selection and focus. Genuine warning states keep explicit text and appropriate semantic distinction. These are current requirements, not evidence that every surface already passes. Neither documentation nor new tokens alone establish measured quality.

The mobile README (local-only prototype documentation, excluded from the formal web source) separates browser preview, controlled adapter tests, native compilation, signing, installation and physical NFC acceptance. Historical tests and static color calculations do not establish current true-device responsiveness, VoiceOver behavior, dynamic text, GPU performance or material quality. Some current controls have visual dimensions below the proposed touch target; audit their actual hit regions before declaring a failure or a pass.

The current inventory implementation loads a full snapshot. Record and history volume must therefore be part of every performance result. The [existing evaluation protocol](experiment-protocol.md) treats reduced staff effort as an untested hypothesis; this proposal extends that protocol rather than inventing an efficiency result.

## Shared interaction and integrity gates

| ID | Criterion | Acceptance evidence |
| --- | --- | --- |
| S01 | **Project invariant:** zero false success, wrong-asset commits, duplicate business records, silent loss of durably saved drafts, or silently truncated exports in the registered acceptance cases. | Isolated real D1 transactions plus visible end-to-end workflows. Include authoritative receipts, affected IDs and fault injection. Zero observed failures is not a universal guarantee. |
| S02 | **Proposed:** 100% of applicable states in the interaction register have defined and tested behavior: idle, focus, press, pending, success, validation error, conflict, unresolved result, retry, cancellation and disabled reason. Mark genuinely inapplicable states explicitly. | State-by-state review and browser/device exercises. Count verified applicable states divided by registered applicable states; freeze the register before testing. |
| S03 | **Project invariant:** staging a scan, finishing an animation or receiving NFC data never commits a movement. Only explicit review and confirmation can submit; success requires an authoritative result. | Single and batch checkout/return with delayed and lost responses. The visible asset/tag/version/loan bindings remain those actually reviewed. |
| S04 | **Project invariant:** unresolved writes retain the original request ID and payload. Retry resolves that request alone; navigation cannot bypass recovery or discard a protected queue. | Offline, timeout, refresh, process termination and late-response cases. App termination recovery uses durable native storage, not a browser-only substitute. |
| S05 | **Proposed:** all registered navigation and temporary-panel transitions respond correctly to rapid repeat input, reversal or safe cancellation. Animation duration alone never disables an otherwise valid action. | Interrupt at roughly 25%, 50% and 75% of progress; check final state, focus, hit targets and retained input. A transaction may legitimately block exit, with a visible reason. |
| S06 | **Proposed:** return to the register preserves the agreed filter, selection and position context; ordinary filtering cannot erase chosen assets or escape a fixed personal/group scope. | Back, detail close, browser history where supported, filter changes and server refresh. Specify deliberate reset actions separately. |
| S07 | **Project invariant:** ownership, active loans, registered storage and dated observations stay distinguishable; unknown data remains unknown. | Long labels, absent data, conflicting evidence and manual/simulated/native sources. Status must have text or another non-color cue. |

Record a clear next action for slow or failed operations. Do not simulate progress percentages, delay real completion to finish a success animation, or present a timeout as a terminal rejection when the result remains unresolved.

## Web requirements

The proposed accessibility target is **WCAG 2.2 AA for the complete in-scope web experience**, including its complete task processes. All applicable A and AA criteria need review; the following table highlights high-risk criteria rather than replacing the complete standard. Automated scans alone cannot prove conformance. See [W3C conformance requirements](https://www.w3.org/TR/WCAG22/#conformance-reqs) and [WAI evaluation guidance](https://www.w3.org/WAI/test-evaluate/).

| ID | Criterion and evidence level | Measurement |
| --- | --- | --- |
| W01 | **External standard:** normal text contrast at least 4.5:1; large text at least 3:1, with the standard's exceptions. | Test actual composed foreground/background states without rounding a failing ratio upward. Large text follows WCAG's size/weight definition. [SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| W02 | **External standard:** visual information needed to identify controls and states has at least 3:1 contrast against adjacent colors, subject to applicable exceptions. | Include required icons, boundaries and selection indicators; decorative separators do not all need 3:1. [SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| W03 | **External standard:** keyboard operability, no keyboard trap and visible focus. **Proposed strengthening:** the focused control is entirely visible, and closing a temporary panel restores meaningful focus. | Complete each core task without a pointer, including at zoom and under sticky toolbars. AA requires focus not be completely obscured; the entire-control rule is stricter. [Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html), [Focus visibility](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html), [Obscuration](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) |
| W04 | **External standard:** pointer targets meet 24 by 24 CSS px or the specified spacing/equivalent/inline/other exceptions. **Proposed strengthening:** standalone controls in touch layouts have at least 44 by 44 CSS px effective targets. | Measure effective clickable areas and check overlaps. Desktop density may differ; a smaller visual icon can have a larger target. [Minimum targets](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [Enhanced targets](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) |
| W05 | **External standard:** text resizes to 200% without loss; ordinary content reflows at equivalent 320 CSS px width. | Test text resizing and 1280px viewport at 400% zoom. Only content genuinely requiring two-dimensional layout may retain local horizontal scrolling; surrounding forms/navigation still reflow. [Resize](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) |
| W06 | **External standard:** applicable status messages are exposed to assistive technology without requiring focus movement. | Read-screen tests of saving, results and errors; avoid repeated announcements from routine polling. [SC 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) |
| W07 | **External standard:** user-applied text spacing must not lose content or function. | Test line height 1.5 times font size, paragraph spacing 2 times, letter spacing 0.12 times and word spacing 0.16 times. These are override tests, not mandated default typography. [SC 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) |
| W08 | **Official platform guidance:** good Core Web Vitals are LCP at most 2.5s, INP at most 200ms and CLS at most 0.1, each at the 75th percentile of real page visits. | Report desktop and mobile separately and segment material device/browser differences. Lab measurements are a separate pre-release gate. [Web Vitals](https://web.dev/articles/vitals) |
| W09 | **Proposed:** local input-to-first-visible-feedback p95 at most 100ms for primary taps, clicks and keyboard actions on the agreed matrix. | Measure from input to the first corresponding rendered feedback. This is our percentile target, not official INP or an Apple mandate; do not time only the handler or wait for backend completion. |

INP represents interaction latency to the next presentation with a defined per-visit aggregation; it is not a save-completion timer. A Lighthouse navigation score or Total Blocking Time cannot substitute for measured INP. Authenticated or low-volume deployments may lack sufficient CrUX data. Record missing field data as not measured and use explicitly labelled lab and, when separately enabled, real-user measurements. Browser capability must be checked by version rather than assuming all Safari versions lack the required APIs. Sources: [INP](https://web.dev/articles/inp), [lab and field differences](https://web.dev/articles/lab-and-field-data-differences), [current cross-browser API availability](https://web.dev/blog/lcp-and-inp-are-now-baseline-newly-available).

**Proposed pre-release lab budget:** under the agreed reference device/network/fixture, LCP p75 at most 2.5s, interaction-feedback p95 at most 100ms, and CLS at most 0.1 in every registered session. The lab percentile and scripted sessions are a project procedure, not a claim of field Core Web Vitals compliance. Measure SPA navigation and data-ready times separately; a good initial LCP does not cover later workspaces.

## iPhone requirements

The first physical acceptance device is iPhone 13. Record its exact iOS version, battery/thermal state, display settings, build and test tooling. Measure a release configuration with realistic data. Browser preview and Simulator runs are useful diagnostics but cannot replace physical-device acceptance.

| ID | Criterion and evidence level | Measurement |
| --- | --- | --- |
| I01 | **Official guidance plus Proposed percentile:** Apple describes roughly 100ms as a noticeable discrete-response boundary; use input-to-first-visible-feedback p95 at most 100ms as our gate. | Include WebView presentation and native transitions. Apple does not prescribe this p95 rule, and main-thread work duration alone does not measure screen response. [Responsiveness](https://developer.apple.com/documentation/xcode/improving-app-responsiveness) |
| I02 | **Official guidance:** button hit regions should generally be at least 44 by 44 points and custom buttons need a press state. **Proposed:** apply that hit-region minimum to all standalone touch controls used in core tasks. | Audit actual screen hit areas, edge targets and overlap. Verify CSS-pixel-to-point mapping in the configured WebView. [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) |
| I03 | **Proposed:** common tasks are independently completable with VoiceOver, including errors, review, NFC status and recovery. | Correct labels, roles, state, order, modal isolation and focus return. Apple's linked criteria govern a claim of VoiceOver support, not a universal App Store admission rule. [VoiceOver criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voiceover-evaluation-criteria) |
| I04 | **Proposed:** common tasks remain usable at default, at least 200% text size and the maximum available accessibility text setting. | Prefer following system text size; verify actual content-font enlargement and reflow, not System Zoom alone. An in-app size control needs a documented mapping and testing at its maximum. Essential content/actions cannot disappear through clipping. [Larger Text criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/larger-text-evaluation-criteria/) |
| I05 | **Official guidance adopted as Proposed gate:** Reduce Motion, Reduce Transparency and Increase Contrast have effective alternatives in custom components. | Change settings before launch and while running; verify the Web layer responds. Required status information remains available. [Reduced Motion criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) |
| I06 | **Proposed:** 100% of registered form/overlay states remain operable with the keyboard and safe-area insets. | Every field, validation message, submit and cancel action is reachable; hiding the keyboard leaves no invalid gap or offset. Exercise rotation where supported. [Keyboard layout](https://developer.apple.com/videos/play/wwdc2021/10259/) |
| I07 | **Project invariant:** background/resume, termination, NFC interruption and native share results retain correct business state. | Exactly one active read session, stale callback isolation, preserved raw evidence, explicit adoption and authoritative transaction receipts. Test real NFC separately from controlled doubles. |

### Frame delivery and hitch metrics

Continuous interactions must keep up with the device's active refresh cadence. Apple describes approximately 16.7ms at 60Hz and 8.3ms at 120Hz; these are display intervals, not universal guarantees or the whole main-thread budget. Average FPS and JavaScript animation-callback spacing do not establish full display-pipeline quality, particularly in a WebView. Use native render traces alongside Web-content profiling where supported. [Apple responsiveness guidance](https://developer.apple.com/documentation/xcode/improving-app-responsiveness)

**Provisional budget candidate:** hitch time ratio below 5ms/s in each registered active scrolling/transition scenario. This is not an executable acceptance gate until the tool, metric definition, WebView/render workload coverage and repeatability have been validated and frozen. Record numerator, denominator and active animation interval; exclude idle time from any manually derived ratio. If the tool exposes a different or perceptually adjusted metric, freeze a separate budget before qualification rather than converting the label alone.

Apple's historical [Tech Talk 10855](https://developer.apple.com/videos/play/tech-talks/10855/) described less than 5ms/s as good. The [current Xcode Hitches documentation](https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app) describes its Organizer metric as good at or below 10ms/s, warning up to 25, critical up to 50, and requiring immediate attention above 50. These references must not be treated as one unchanged measurement standard. Our below-5 candidate is informed by the historical guidance; its numerical value alone cannot establish that it is stricter than a differently defined metric.

### Launch and sustained use

Record launch to first app content, launch to usable core controls, and launch to authoritative inventory data separately. A native blank container or static splash does not qualify as usable app content. Separate cold start, warm start and resume under documented cache/process conditions.

Apple's [2019 launch presentation](https://developer.apple.com/videos/play/wwdc2019/423/) gives a 400ms target around drawing a usable initial frame; it does not promise network data is ready in that time. Treat it as an ambitious reference. A numerical iPhone 13 launch gate remains **open pending the first physical baseline**, then must be agreed before implementation qualification. Do not redefine the metric after seeing a slow result.

**Proposed sustained-use check:** three repeatable 15-minute sessions of browsing, selection, panels and recovery, with no crash, unexpected reload or lost state. Explore retained-memory trends after warm-up using fixed workflow cycles and sampling points. Investigate reproducible continued growth that documented cache behavior does not explain; a finite session cannot prove unbounded growth. Freeze the tool, cycle count and permitted growth budget after baseline before adopting a numerical memory gate. Record energy/thermal observations and render degradation separately. This does not establish a population crash rate, battery-life percentage or universal memory ceiling.

## Visual materials and motion

The agreed direction is a light, restrained, translucent workspace. Keep the existing identity unless separately redesigned. Visual review covers alignment, typography, hierarchy, density, material boundaries and state clarity in actual workflows.

| ID | Proposed criterion | Evidence |
| --- | --- | --- |
| V01 | Every shared component uses the agreed semantic color, spacing, typography, shape and motion tokens, or has a documented intentional exception. | Review the component inventory and actual rendered states. Token reuse is a consistency check, not proof of beauty. |
| V02 | Glass materials are limited to approved navigation/control surfaces. Tables, asset identity, warnings and reviewed transaction evidence retain a stable readable backing. | Reference screenshots and interaction recordings; no competing glass layers that obscure hierarchy. [Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials) |
| V03 | Every translucent component passes relevant contrast/readability checks on permitted bright, dark, patterned and moving backgrounds, including focus, selected and disabled states as applicable. | Test actual compositing, not just token pairs. Constrain the underlay when necessary to ensure contrast; provide an opaque fallback for unsupported effects and accessibility settings. |
| V04 | Every custom transition has a defined purpose, start/end state, interruption behavior and reduced-motion alternative. | Register the transition and test it with real input. A state change may deliberately be immediate. Animation coverage percentage is not a quality target. [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion) |
| V05 | No reproducible overlap, clipped essential text, inaccessible action, accidental page overflow, stale interactive duplicate or wrong-object visual transition in the acceptance matrix. | Long labels/IDs, empty/loading/error states, maximum batch, narrow/wide layouts, text enlargement and repeated inputs. Local scrolling is permitted where intentional. |
| V06 | Visual and motion review is tied to recorded reference scenarios rather than an unsupported universal aesthetic score. | Use the anchored comparative review below; retain disagreements and reasons. |

**Proposed starting motion tokens, not acceptance facts:** press/hover feedback 80–160ms; small content/state transitions 160–240ms; panels/navigation 220–360ms. Their start response must still meet latency targets. Springs need a recorded settling definition instead of pretending they have a fixed duration. Deviations are allowed when a tested interaction justifies them. Frequent actions may use minimal or no spatial motion. Never prolong a transaction or lock input to satisfy a duration range.

No universal opacity, blur radius, spring constant or percentage of animated elements is adopted. Those values depend on background, display, performance and task. Prefer the least expensive material that achieves the reviewed effect; measure the actual result. [Web animation performance guidance](https://web.dev/articles/animations-guide)

## Representative tasks and conditions

| Task | Required outcome and variants |
| --- | --- |
| T1 Find and inspect | Locate the right battery, distinguish loan/owner/home/observation, inspect history, return with context, and export the intended complete scope. |
| T2 Check out | Stage 1, 3 and 100 assets, review exact identity/evidence, confirm as the authenticated staff account and retain the open station. Human timing can use the representative 3-asset case; engineering tests cover boundaries. |
| T3 Return | Return exact active loan pairs, including different holders, with optional dated placement distinct from registered home. |
| T4 Register | Reuse model/common batch data, preserve unknowns, retain drafts and acknowledge only confirmed registration. Keep demonstration-only intake limits. |
| T5 Teaching group | Use the fixed private group scope, review alternatives and perform the actual movement without silently rewriting group membership. |
| T6 Task and message | Find an assigned task and complete it within the actor's role. Staff may add actual inspections; historical charging records remain administrator-only. Task completion does not itself create per-battery inspection or charging evidence. Distinguish reading from completion and avoid duplicate entry within each permitted workflow. See [permissions](permissions.md). |
| T7 Lifecycle | Review scrap/remove/recover actions and permissions; preserve identity/history where required. Administrative deletion cases run only on isolated fictional fixtures. |
| T8 Failure and recovery | Network loss, response loss, stale versions, concurrent checkout, authentication expiry, storage failure, refresh and app termination. Apply relevant variants across T1–T7, not only on a separate error demo. |

**Proposed performance fixtures:** 100 and 1,000 batteries with 10 history entries per battery, plus a 10,000-battery stress exploration. Include long labels, unknown fields and mixed lifecycle states. These synthetic counts are not an assertion of expected inventory size or validated capacity. Freeze a realistic release fixture once actual scale is supplied; report stress results separately. Never load-test the hosted business inventory as part of local acceptance.

**Proposed network conditions:** a reference profile capped at 10Mbps down / 2Mbps up / 100ms round-trip latency; a constrained profile at 1.5Mbps / 0.75Mbps / 300ms; and offline/lost-response cases. Document whether latency is total or added, and record actual service delay. Feedback/integrity gates apply throughout; do not apply the same full-data completion time to all network profiles. These are reproducible lab profiles, not claims about campus coverage.

Freeze desktop hardware, browser versions and native tooling before final qualification. Proposed web coverage is Windows Chrome and Edge, macOS Safari, and iPhone Safari; Firefox coverage remains a scope decision. Add a second native performance class before making claims beyond iPhone 13. Test 320, 390, 768, 1280 and 1440 CSS px widths where appropriate, with actual device viewport metrics taking precedence. Tablet-width web checks do not establish a native iPad experience.

For local performance exploration, collect at least 30 samples per discrete interaction class. **Proposed qualification procedure:** 100 samples across at least three sessions for each critical class; report median, nearest-rank p95, maximum and all raw values. For each registered page-load condition, collect 100 loads across at least three sessions and report median, nearest-rank p75, maximum and raw values. Keep cold-cache and warm-cache loads separate, and record process state. Failures and exclusions retain their reasons and cannot silently be replaced by successful runs. App launch sampling remains separate and must be frozen with its launch budget.

Calculate acceptance percentiles separately for each required device/browser, network profile, fixture and interaction class. Retain per-session summaries; easier conditions cannot offset a failing required condition. Freeze the initiating event and presentation-detection method for each class. Physical touch-to-display, pointer-down, activation and key-down timings are separate measurements where applicable. A handler timestamp or animation callback alone does not establish that pixels were presented; record measurement resolution and uncertainty.

For continuous motion, use at least three 60-second active scenarios per fixture and condition, without idle dilution. These are engineering sampling procedures, not user-study sample sizes or population confidence guarantees.

## Staff evaluation and Apple comparison

Run the first study with 6–8 actual or prospective staff. Record relevant experience and any accessibility needs. Freeze each participant's assigned tasks, role and eligible scenarios before testing; a failed attempt cannot later become not applicable. Give equal orientation, use matched fictional tasks and counterbalance order. Separate observed problem-finding sessions with think-aloud from timed trials, because prompting and commentary can alter completion time. Moderator help converts an otherwise completed task into assisted completion. Abandonment remains a failure in the denominator. [GOV.UK moderated testing guidance](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing)

### Staff workload

Compare battery workflows against the stakeholder's observed current method and the recorded pre-change build where useful. Do not invent that baseline from assumed spreadsheet steps. Use [the existing evaluation protocol](experiment-protocol.md) for paired outcomes.

| Measure | Proposed first-pilot criterion |
| --- | --- |
| Correct unassisted completion | At least 90% of assigned core task attempts overall; publish each task's numerator/denominator as well. Every reproducible blocking issue requires repair even if the aggregate passes. |
| Critical errors | Zero false success, wrong-asset commit, duplicate movement or silent protected-draft loss in the study. Human misunderstanding of saved versus pending state is a finding requiring repair. |
| Workload improvement | Candidate target: median of each participant's paired improvement `(baseline time - new time) / baseline time` at least 20% for each selected high-frequency workflow, without worse completion, correctness or recovery. Freeze task-specific targets after observing the baseline and before testing the new version; a 20% gain is not claimed now. |
| Repeated entry | Common model/owner/storage information entered at most once per eligible batch; account identity is never retyped as a substitute holder; recovery of durably saved work requires no re-entry of that saved content. |
| Per-task ease | Median at least 6 on a clearly labelled 1–7 question from very difficult to very easy. This is our project criterion, not an Apple score or a validated population estimate. |

Report paired times, range, help, errors, abandonment and rework per task and participant. Predefine task timeouts and the treatment of incomplete attempts. Compute time improvements for correctly completed matched pairs, publish how many pairs were excluded from that calculation and why, and require completion and correctness not to worsen. Failures remain in the separate outcome denominator. Avoid presenting p95 user-task time from 6–8 people as a stable population estimate. Small pilot percentages must include counts.

### Comparable Apple interactions

Freeze reference product, OS/browser, date, dataset and exact task before comparison. Candidate web reference: [iCloud Drive list, sort and information views](https://support.apple.com/en-lb/guide/icloud/mmebf050837b/icloud). Candidate iPhone reference: [Files navigation, selection and organization](https://support.apple.com/en-mt/guide/iphone/iphab82e0798/ios). These are reference candidates, not applications measured in this research.

Compare matched patterns such as opening/closing details, selecting several items, opening a menu, entering text, or returning to a prior context. Match information load and input demands. Exclude an unmatched pattern with a reason. Do not compare end-to-end battery checkout time against file selection or a marketing-page animation. Prefer local reference content when isolating interaction latency; disclose remaining backend/network differences.

Use paired live interaction for responsiveness/control and standardized captures for visual review. Counterbalance presentation order and neutralize labels where practical; participants may still recognize Apple, so do not call the study fully blinded.

**Proposed comparative rubric:** collect one rating per participant, matched scenario and dimension on a 1–5 scale: 1 substantially worse, 2 somewhat worse, 3 comparable, 4 somewhat better, 5 substantially better. Rate visual coherence, reading clarity, motion comfort and control separately. For every scenario and dimension, require a median of at least 3 and at least 75% of eligible participants rating at least 3; also resolve and retest all reproducible blocking findings while retaining the original results. Do not average strong scenarios over weak ones or count one person's repeated ratings as extra participants. The required count is `ceil(0.75 * eligible participants)`: at least 5 of 6, 6 of 7, or 6 of 8. Freeze this rule before testing. These thresholds express a proposed stakeholder acceptance rule, not scientific proof of general parity.

To describe a specific scenario and dimension as better in the pilot, require a median at least 4 and at least 75% ratings of 4 or 5, alongside the technical and correctness gates. Report the dimension, reference, task, device and count. For instrumented comparable interactions, report paired differences in feedback and completion latency separately. Candidate observed parity tolerance is at most 10% slower at the median for a matched task, with no correctness loss. Calibrate timing noise in exploration, then freeze the practical margin and procedure before a subsequent qualification run with new observations; report the exploratory timing differences descriptively. A broader non-inferiority/superiority claim needs a separately powered study and predeclared margins. Failure to find a difference does not prove equivalence.

## Acceptance evidence and open decisions

Keep protocols and concise results under `docs/`, and raw local traces, screenshots and fictional trial data under ignored `work/qa/`, following the established experiment protocol. A result row should include:

| Requirement | Build and reference | Device and condition | Fixture and sample | Result | Evidence and limitation |
| --- | --- | --- | --- | --- | --- |
| Example only | Exact versions | Exact hardware/OS/tool/network | Named dataset and count | Not measured | No acceptance run has been performed under this draft. |

Before implementation qualification, resolve:

1. Exact iPhone 13 iOS version, availability of Mac/Xcode profiling, and supported device/OS floor. Physical testing is arranged in principle; tool availability is not yet confirmed.
2. Desktop baseline hardware and required browsers, actual inventory/history volume and representative campus network conditions.
3. Acceptance or revision of the proposed 100ms feedback percentile, local hitch metric/budget, user-study criteria and workload target.
4. iPhone launch/data-ready budgets and server-backed task completion budgets after initial baselines. Preserve the initial measurements and reasons for the chosen thresholds.
5. Exact Apple reference scenes and versions, plus the transition register. User confirmation of the reference set is distinct from claiming its performance has been measured.

The next local work is to baseline and prototype the inventory list, battery detail and reviewed checkout/recovery flow on web and iPhone. Evaluate those representative surfaces before expanding the visual system across every workspace. Revise targets only through a recorded scope decision; do not lower them silently to match an implementation.
