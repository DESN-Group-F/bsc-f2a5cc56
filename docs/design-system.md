# Workspace design system

The local web refactor uses a neutral near-white canvas, stable white record surfaces and blue for primary actions, selection and keyboard focus. The application mark and favicon are blue and white. Green, amber and red continue to communicate recorded success, caution and errors. Ordinary In use and New arrivals states do not imply a warning. A recorded loan is not physical sensing; observation, registered home, ownership and holding remain distinct.

The after-4 checkpoint is a stable engineering foundation, not final product-experience acceptance. Structural-3, structural-4 and structural-5 retain their recorded automated and browser evidence as historical snapshots. The current auxiliary-queue revision follows the accepted visual finish and retains its materials, controls and business guards. Its scoped local verification and final source anchors are recorded in `frontend-refactor-implementation.md`.

## Stylesheet ownership

`app/globals.css` imports theme, base, shell, auth, components, inventory, workflows, motion, loading and finally materials. The application shell imports `sidebar-workbench.css` for its coordinated navigation geometry. The former `workspace.css` and `workbench.css` override layers are no longer imported. Their relevant movement and activity layouts now belong to `inventory.css`.

| File | Responsibility |
| --- | --- |
| `styles/theme.css` | Semantic color pairs, materials, type, radii, shadows and duration tokens |
| `styles/base.css` | Document defaults, focus baseline, selection, reduced motion and forced colors |
| `styles/shell.css` | Workspace hierarchy, header, navigation appearance, range controls and responsive framing |
| `styles/sidebar-workbench.css` | Sidebar spring geometry, compact labels/counts, active marker and mobile portal |
| `styles/auth.css` | Split sign-in composition, identity materials, status and responsive layout |
| `styles/components.css` | Shared controls, tables, feedback, forms and overlays |
| `styles/inventory.css` | Inventory toolbars, filters, evidence and shared record layouts |
| `styles/workflows.css` | Stations, teaching groups, tasks, messages, accounts and model workflows |
| `styles/motion.css` | Common press, disclosure, tab and overlay presentation |
| `styles/loading.css` | Shared initial-loading skeletons, battery activity and non-disruptive refresh feedback |
| `styles/materials.css` | Final shared material states, opaque preference fallbacks and toolbar control metrics; no business layout ownership |
| Component CSS modules | Record-specific layout, the inventory register and Review queue; each detail sheet width has one owner |

Responsive layout rules belong with their component. `materials.css` is the explicit last import for shared surface and control consistency; feature layout must not migrate into this layer. The mobile application copies shared frontend sources through its explicit synchronization script; changing web files does not itself publish or rebuild a native application.

## Sign-in and asynchronous feedback

Sign-in uses the application's battery motif with layered entrance and status transitions. Decorative motion uses transforms and opacity, respects reduced motion and does not obstruct the form. The form performs explicit English validation with field errors and focus on the first invalid input; browser-localized required-field bubbles are suppressed. It reads current form values so password-manager autofill remains supported.

`LoadingState` represents a real initial read; `RefreshStatus` delays brief refresh feedback and retains existing content. The latter uses a short exit transition instead of abruptly removing its status. Slow-request text appears after six seconds for shared reads, with a separate eight-second sign-in hint. Reads time out after thirty seconds with explicit retry. A timed-out authentication write instead offers a session check, avoiding an automatic repeat of credential or setup submission. No progress percentage or success is fabricated.

Refreshes retain data only within the same account and request context. Stale data cannot authorize account, task or beacon changes. Inventory polling is single-flight and pauses during manual refresh, initial loading and blocking workflows. Offline indicators describe browser connectivity only; server confirmation remains necessary for success.

## Color and material

| Purpose | Token | Value |
| --- | --- | --- |
| Text | `--foreground` | `#1c2433` |
| Secondary text | `--muted-foreground` | `#586477` |
| Canvas | `--canvas` | `#f5f6f8` |
| Record/form surface | `--surface` | `#ffffff` |
| Subtle surface | `--surface-subtle` | `#f2f3f5` |
| Action / foreground | `--primary` / `--primary-foreground` | `#075dcc` / `#ffffff` |
| Action hover | `--primary-hover` | `#064da9` |
| Selection | `--selection-surface` | `#eaf2ff` |
| Selection hover | `--selection-hover` | `#dceaff` |
| Control border | `--border-strong` | `#7d899a` |
| Focus | `--ring` | `#075dcc` |
| Resting material | `--glass-surface` | `rgb(255 255 255 / 88%)` |
| Hover / focus-within material | `--glass-surface-active` | `rgb(255 255 255 / 98%)` |
| Touch material | `--glass-surface-touch` | `rgb(255 255 255 / 96%)` |
| Material blur | `--glass-blur` | `16px` |
| Toolbar height / icon | `--control-height` / `--control-icon-size` | `44px` / `16px` |

Navigation, the global header, the Review queue, sign-in identity panels and shared popover, select, dropdown and combobox surfaces use the same material rules over a neutral canvas without a blue page gradient. Supported browsers use 88% white at rest and 98% on focus within or fine-pointer hover; coarse-pointer and hoverless interaction use 96% without requiring hover. Background opacity changes do not fade the text. Tables, evidence cards, selected-record items and forms remain opaque. Opaque styles are the default, with transparency and blur enabled through `@supports`. Reduced-transparency and forced-color rules replace all three material tokens with solid surfaces and remove blur; reduced motion disables material transitions. These implementation rules do not establish contrast in every composed state or complete browser preference support. The sign-in workflow illustration does not represent inventory data or measured results.

Warning colors remain for recorded inspection concerns, recovery, uncertain or pending work, selection-scope changes and movement limits. Informational scan notices and ordinary recorded-loan states use neutral or informational colors. New arrivals uses the action/selection vocabulary while retaining its independent unread and acknowledgement semantics.

Older yellow-theme contrast results do not validate this theme. Recalculate actual color pairs, then inspect composited states and interaction affordances. Static calculations alone are not WCAG conformance evidence.

## Reading and layout

Platform system fonts are preferred and no remote font is fetched. Body text is 16px; operational controls and record data generally use 14px, supporting labels generally 12–13px. At widths up to 767px, general workspace titles use 28px text and the compact inventory title uses 25px. Identity, long names and evidence must wrap instead of being clipped.

The global header groups inventory scope, refresh, the source disclosure and the signed-in account. Demonstration/working context preserves its source and placeholder explanation. The expanded desktop navigation is 208px wide. The workspace below has its own title and, in the compact inventory heading, Register battery. At widths up to 767px the button displays Register while retaining the accessible name Register battery. Scan checkout and Scan return belong to the Review queue.

The inventory composition pairs the record register with a top-aligned Review queue. It starts closed and preserves the user's choice through selection, filtering, paging and resizing while the inventory instance remains mounted. At workbench widths of at least 1100px, opening reserves a real 280px grid column with a 16px gap, leaving at least 804px for records. The auxiliary column sticks below the measured topbar and scrolls its body internally. Closing leaves a 52px labelled rail and 12px gap; hidden expanded content contributes no layout height. Below that workbench threshold, opening uses the existing modal Sheet. At viewport widths up to 767px the closed entry becomes a 44px horizontal row above full-width records. This avoids squeezing narrow record cards. Entry count and scope/limit attention remain available without hover.

The queue contains selected identities, existing guarded actions, scan entry points and scope information; choosing a record does not save a movement. A single queue presentation switches between the desktop aside and Sheet, so its presentation DOM remounts across those modes. Selection, filters, paging, group-editor state and the scope-totals disclosure remain in the stable InventoryTable parent. Layout switching waits while a business overlay is open. Queue opening is not part of the business modal lock. Hidden retained inventory releases its Sheet through the active prop while preserving the saved opening choice; reactivation waits for a valid width measurement before opening a Sheet. No bottom-page reservation or floating-panel focus avoidance remains in the active inventory layout.

New arrivals sits beside Filter in the shared inventory toolbar. It remains an ordinary removable criterion with its existing acknowledgement behavior, separate from the three status tabs. It is absent from personal inventory views and opened teaching groups. At widths up to 767px, the inventory toolbar hides Applied filters and its disabled Clear filters control when no criteria are active. Active criteria expose their chips and Clear filters. Clearing criteria preserves selected records, inventory and fixed personal/group scope. Downloads and explicit selection remain available.

On narrow screens the inventory uses the same table and event handlers, reflowed into labelled records. Current holder, registered home, responsible owner, status, identifiers and evidence remain present. There is one selection state and one set of interactive controls, with explicit table semantics. Detailed evidence still expands in place. Other dense administrative evidence tables may keep local horizontal scrolling.

Shared toolbar controls use a 44px minimum height, the control radius and consistent icon spacing; the rule includes nested pagination buttons and Clear filters. Primary, destructive and tertiary actions retain their semantic differences, and a pressed New arrivals control retains its selected appearance on hover. Touch and narrow-screen buttons use at least 44px heights. Small visual checkboxes keep their semantic controls and expanded hit areas. Verify neighbouring hit areas and keyboard behavior in the real browser; CSS dimensions alone are not a complete accessibility result.

Sign-in uses a full-height split composition on desktop: a 36% identity area with the Battery mark, institutional context and a Register / Check out / Return / Trace illustration, alongside an open white form area. At widths below 900px the identity area reduces to a compact translucent brand strip followed directly by the form. Inputs and the primary action have 48px minimum heights. Setup fields, errors and retry feedback grow in normal document flow so short screens can scroll without clipping the form. The authentication form keeps its existing state and callbacks across these layout changes.

## Feedback and motion

Sign-in separates checking, unavailable, ready, submitting and opening. Initial session-check failure offers retry. Setup success returns to sign-in. A server-confirmed session starts navigation immediately; no timer invents authentication success or holds a completed login. Same-event duplicate submissions are ignored. Credentials remain transient input state.

Navigation and filtering update state synchronously, then animate the current content. No old record screenshot covers new click targets. Sidebar and disclosure springs retain velocity when interrupted. Reduced motion suppresses newly started spatial animations. When the preference switches on during motion, the shared spring settles at its target with zero velocity, workspace-transition and observer WAAPI animations cancel, and any informational-exit copy is removed. `ReceiptAction` also ends its optional 190ms check phase immediately and shows the confirmed result; its geometry uses the shared spring. Controlled preference-change probes cover these paths, but changing the operating-system preference in a real browser has not been verified. Transaction receipts, original requests, recovery guards and draft retention are independent from animations.

Receipt actions use 44px height in shared toolbars and retain the 48px default in workstations. Pending/check circles and confirmed pill radii derive from the control's untransformed computed height, with `offsetHeight` as the fallback, so press-scale transforms do not distort those geometry targets.

Programmatic dialogs and sheets capture their opener before autofocus. Closing preserves a caller's explicit focus policy, another dialog's focus or an explicit workspace-navigation focus; otherwise it returns to the available opener. If that opener has been replaced, an already connected, visible and enabled focused control is preserved; only absent or unusable focus falls back to the workspace. This avoids late unmount callbacks overriding a responsive replacement control. Browser tests must cover nested export, cancel, Escape and mobile navigation.

ReviewQueueSurface owns presentation focus and scrolling. Desktop collapse makes the retained pane inert and returns focus to its visible entry. Sheet uses the shared Radix modal/focus behavior; closing returns to the entry unless navigation or another dialog takes priority. Mode changes capture the focused action's accessible label or text and restore a visible enabled equivalent, falling back to the queue heading. The body scroll position is retained independently of focus; restored actions are revealed within that body. Ordinary focus capture also reveals the target within the queue body, including Radix Tab-loop focus that prevents native scrolling. The original nested-overlay opener is captured when a mode change is deferred and takes priority over interim automatic focus. Closing Sheet content is immediately inert even while its exit animation retains the DOM. The old Sheet close callback does not override focus already restored in the new desktop pane. Removing a queued item focuses the next removal control, the previous one or the queue heading through the stable data-review-queue host. Removing an inventory filter chip or clearing criteria still first focuses Filter. The former bottom-floating queue-focus helper is no longer imported by InventoryTable; its polish-era results describe the previous layout only.

`lib/client/station-focus.ts` is installed through a separate `WorkspaceMotion` layout effect. It measures the global header and positions persistent station exit bars below it. On the next animation frame after focus enters a station control, it checks the visible header and exit bar and scrolls instantly only if the control would be covered or lacks the intended 12px clearance. It ignores controls inside the exit bar, hidden/inert content and dialogs, and does not change focus, drafts or station business state. Its independent probe passed 32/32. Structural-4 browser checks at 320px confirmed visible, center-hit-testable controls below the exit bars in Intake, Removal and Scan; these passes cover the recorded controls and states, not every station field or viewport.

Conditional business dialogs close immediately when their domain handler permits closure. Ordinary battery-detail dismissal and completed or cancelled exports may leave a 120ms inert decorative copy while the real overlay and its interaction locks are removed. Password/file forms, pending recovery, transaction forms and context switches do not use this copy. New input, another dialog or a reduced-motion change cancels it. A presentational exit must never delay receipt processing, change a request, discard a protected draft or leave an invisible control active. Evidence is tracked in `frontend-refactor-implementation.md`.

## Verification boundaries

The following results belong to historical structural snapshots, not the current visual-finish candidate. Those checkpoints passed TypeScript checking, modified-source ESLint and production builds, retaining the pre-existing large-chunk warning. Automated evidence includes the initial 176-case structural closure, separate authentication and query probes, the 49-case affected rerun, former queue-focus probes and the 32-case station-focus probe. These snapshot-specific, overlapping results are detailed in `frontend-refactor-implementation.md` and must not be combined into a new total.

The coordinator's structural-3 browser checks passed Clear/chip focus restoration, the compact-to-desktop queue transition, queue-detail close, desktop export cancellation followed by narrowing, and fixture checkout cancellation, confirmed checkout and exact return. Structural-4 checks passed the recorded focus positions in all three stations and the 320px inventory toolbar: Filter, New arrivals and Download share a 44px-high row, with a 305px document width. A subsequent private mobile copy synchronized 133 shared files and built successfully; the main mobile project was unchanged. This supersedes the earlier 132-file copy for compatibility evidence at the later captured version, without establishing physical-device acceptance or validating subsequent edits.

Structural-5 verified that snapshot's final two CSS corrections. Below 641px the Scan tag input and its action stacked: at 320px, the input was 207 by 46px and displayed the complete tested tag value; the button was 207 by 44px below it. Both were visible and center-hit-testable beneath the station bar. At desktop widths, active Applied filters used a complete second toolbar row, with the chip and Clear filters arranged horizontally. Empty criteria retained the compact layout. That local production build passed; historical source hashes and screenshots are recorded in `frontend-refactor-implementation.md`.

The preceding visual finish has scoped local validation. Polish-2 real-browser checks passed upper and lower hit tests for the complete wrapped chip and confirmed 44px Directory Search, Clear and Download controls, including Download's idle and confirmed states. Polish-3 and the final cancellation-aware polish-4 candidate passed the retained page-size focus check after resizing from desktop to 390px: the control is fully above the queue, the hit test succeeds and the queue remains open. The workbench also rechecks after cancellation of its own relevant layout transitions, covering the source-derived reduced-motion interruption edge through controlled verification. Final frozen source anchors, build records and the independent 88-case affected regression are recorded in `frontend-refactor-implementation.md` and the audits. Real-browser operating-system preference switching, complete composited contrast coverage and native/performance acceptance remain outside the completed evidence.

Earlier after-4 measurements remain foundation evidence only. Independent findings are recorded in `frontend-refactor-functional-audit.md` and `frontend-refactor-visual-audit.md`. This local engineering handoff does not claim overall product acceptance, complete WCAG 2.2 AA conformance, Apple comparison parity, workload improvement or native/performance acceptance. Proposed targets remain in `frontend-quality-standard-draft.md` until measured with its stated procedure. No Git push or hosted deployment was performed.
