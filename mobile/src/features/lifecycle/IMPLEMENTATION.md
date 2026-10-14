# Manual registration implementation

12 October 2026. Local phone implementation only. No publication, deployment or production-data modification was performed by this implementation task.

`ManualRegistration` is a dedicated phone form for one operator-entered battery. It uses the existing `operator_register` action and `operator-registration-session` schema/receipt verifier. The source service supports both shared inventories through `OperatorRegistrationStore`; the screen also requires the actual snapshot's `capabilities.operatorRegistration === 1`. It never switches inventory or offers a manually allocated permanent Battery ID.

Blank specifications remain null. The building is J18, selectable rooms are optional, responsible owners must resolve to active native staff accounts, and review freezes the loaded owner/building/room versions. First use has explicit registration-date, known-date and unknown choices. The existing low-level model picker retains source/hash guards and conflict choices. No NFC input or location capture is introduced.

Review captures one immutable request. Confirmation preserves and verifies that request in durable storage before fetching. Uncertain results retain the same payload and request ID; retry sends only that original request. Rejected requests remain until explicit acknowledgement returns to editable details. A matching server receipt and an atomic durable acknowledgement are both required before the success view. If acknowledgement fails, the attempt and draft remain available for exact replay. Unsubmitted drafts are retained on normal exit.

Cancel registration opens a separate local confirmation for an unsubmitted draft. Discard draft and exit removes only that exact draft in an atomic durable transaction. Existing registration requests, unreadable retained data and any unresolved model request, including an empty or unreadable model key, prevent deletion. The original account, inventory and draft bytes are checked again before the transaction and inside it. Storage delays keep the screen locked; failed acknowledgement preserves the draft and requires an explicit retry. Successful acknowledgement suppresses all further autosaving in that mounted screen before exit. Review shows the responsible staff name and username; stable account identifiers remain in the captured request guards.

Recovery integration exports from `manual-registration-model.mjs`:

- `operatorRegistrationStorageKey(accountId, dataset)`: `battery-operator-registration:<accountId>:<dataset>`.
- `operatorRegistrationDraftKey(accountId, dataset)`: the same key with `:draft`.
- `recoverOperatorRegistrationAttempt` and `recoverOperatorRegistrationDraft`: validate identity, dataset, exact schema and retained values.
- `discardOperatorRegistrationDraft(storage, { actorAccountId, dataset, expectedDraftRaw, modelRequestKey }, isCurrent)`: acknowledges deletion of a verified unsubmitted draft without modifying requests, models or unrelated recovery queues.

Attempt metadata contains `actorAccountId`, `dataset`, `payload`, `status` and `message`. The official business state remains on the existing server. Receipt preferences use `preference:operator-registration-receipt:<requestId>` and do not represent unfinished work.

Actual checks: all 18 `mobile-manual-registration.test.mjs` tests passed. They cover live/demo preservation, automatic identity, explicit unknowns, directory/model evidence capture, service/context/room/owner validation, Sydney first-use semantics, durable pre-submission saving, failed atomic acknowledgement, exact retry, receipt mismatches and account/dataset isolation. The actual JSX component is exercised through a hook/event harness against the real durable-storage driver for cancellation confirmation and withdrawal, delayed/failed acknowledgement, retained request and model guards, empty/corrupt keys, changed contexts, transaction races, stale confirmation handlers and prevention of autosave after deletion. JSX transpilation syntax passed. The combined manual-registration, removal and Mapping tests passed 44/44. This hook harness does not render a browser DOM or establish phone layout acceptance; configured-service interaction, browser UI confirmation and native process-termination recovery remain in the coordinating integration/device review.
