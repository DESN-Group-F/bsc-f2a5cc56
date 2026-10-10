# Frontend source snapshot — 10 October 2026

This snapshot publishes the reviewed frontend refactor on `battery-frontend-refactor-20261010`, based on the neutral 0.8.0 source commit `78cfe71677dcef414d1c482a83e60c3d62f789b4`. Package version remains 0.8.0. It is a source update, not a new numbered release or a hosted deployment.

## Included behavior

The sign-in and inventory workspace use the revised blue-and-white visual system, shared control sizing, clearer responsive navigation and motion that follows the reduced-motion preference. Shared overlay handling restores usable focus after nested dialogs, navigation and responsive container changes. Existing review, permission, pending-request and recovery guards remain in force.

The Review queue starts closed. A sufficiently wide workbench opens a real 280px auxiliary column aligned with the records top; closing leaves a 52px entry. Smaller workbenches use a modal drawer, with a horizontal entry above records on narrow screens. Selection, filtering, pagination and totals disclosure remain in the parent inventory state. A business dialog defers a container change until it closes. Queue presentation does not submit a business operation.

## Validation and limits

The implementation and independent audits record actual source checks, targeted regressions and local browser outcomes in [the implementation record](../frontend-refactor-implementation.md), [functional audit](../frontend-refactor-functional-audit.md) and [visual audit](../frontend-refactor-visual-audit.md). Earlier failed candidates and the limits of controlled DOM probes remain documented.

Final targeted browser checks passed for restoring the selected battery opener after detail/resize/close, keeping reverse-Tab targets visible and restoring focus when reopening during drawer exit. The independent high-screen check confirmed aligned records and queue tops, compact closed geometry and preserved selections. Recorded browser warnings and errors were empty. These results do not establish exhaustive browser, accessibility, performance or physical-device acceptance.

The final source passed TypeScript checking, changed-source ESLint and the production build. Four affected business suites passed 54/54 at their unchanged table snapshot; the final shared-focus probe passed 31/31, and the retained-pane model passed 9/9 after reproducing the earlier failure. These overlapping checks are not a combined coverage total. The existing large-client-chunk build warning remains.

The isolated publication snapshot then passed TypeScript checking, full ESLint, a fresh production build and 79 tests across seven relevant suites, with zero failures or skipped tests. This checks the source publication boundary after excluding local prototypes. Private logs and manifests remain under ignored `work/publish-frontend-20261010/`.

## Publication boundary

The source tree retains the preceding formal web boundary. Backend sources, migrations, dependency declarations and the lockfile remain unchanged from 0.8.0. Shared Teaching NFC and operator-entered registration contracts already required by the web application remain included. The separately managed native/mobile prototype, diagnostic route, cloud-build configuration and preparation guides remain local and excluded.

Publishing uses the `admin` identity and the preceding neutral source snapshot as its sole parent. It preserves existing remote branches and tags. Local execution profiles, credentials, sessions, business databases, dependencies, generated builds, private QA files and research archives are excluded. The required `.openai/hosting.json` protocol configuration and third-party license notices remain for their technical and legal functions.

The current hosted application and its business data are unchanged. This publication does not restart a service, apply migrations, upload a local database or replace the existing local preview data.
