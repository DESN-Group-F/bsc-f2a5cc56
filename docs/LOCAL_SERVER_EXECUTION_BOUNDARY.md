# Preparation and runtime execution scope

Decision: ADR-EXEC-001, v0.3.3, with the 2026-09-23 collaboration clarification. The execution stage remains `LOCAL_CONTROLLED_DATA_PROCESSING`. This document governs execution environments; it sets no universal acceptance threshold and does not prevent parallel test preparation.

## Work in contributors' own checkouts

Contributors may write and review English documents, test questions, reference answers, case inputs, implementation drafts, schemas, configuration examples and runner drafts within their assigned tasks. AI may perform detailed drafting; people review and accept the work.

Test authors do not need the owner's drive, full source collection, running database or Qwen endpoint. Design cases around intended behaviour and identify fixtures/interfaces for the owner to provide later.

The data/database workstream belongs to the project owner. Authorised work may include source inspection, extraction, cleaning, conversion, bounded experimental analysis and related checks. Existing source/version/action evidence governs use. Originals remain read-only; reuse manifests instead of repeating collection-wide inventories or hash audits.

Parsing/conversion tests, field-contract checks, numerical-consistency checks and queries against temporary files/databases may run when relevant to an authorised processing task. They establish only that scope, not deployment readiness, model scores, system acceptance or field safety.

## Actions not started by onboarding or test drafting

T00, production/target database or RAG deployment, Qwen inference, model-performance evaluation, large embedding/reranking jobs, production services, server access and fine-tuning do not start automatically. Do not run inherited handoff/system-test commands merely because they occur in an older plan.

Do not scan unspecified directories, inspect historical private answer keys, unpack all archives, execute source-document code/macros, download models, alter system environments or upload the source collection as part of preparation.

Private GitHub collaboration is authorised for reviewed code, authored documents/reports, configuration examples and metadata-only catalogues. Raw sources, extracted text, experimental/derived payloads, private keys/answers and machine secrets remain excluded. Git permission does not authorise transfer of data to a runtime or model service.

## Before a runtime task

The owner will scope the first database-plus-Qwen execution separately. Identify its environment/workspace, dependencies, actual model service, selected inputs, access and cost permissions, secrets and result location. Any source transfer uses a selected manifest rather than a whole-folder upload.

These are operational prerequisites for execution, not a team-wide quality gate. Draft questions before the runtime is configured. Agree interfaces, measurements and acceptance criteria for each task; there is no requirement here to finish a universal checklist before any Qwen test.

The server remains the designated environment for authoritative system/model/deployment evaluation and future training. Local document reviews and parser checks are not those runs. Record future environment changes when actually decided.

## Evidence and separation

- Separate source data, case uploads, development tests, held-out acceptance material, logs and later training data. Model-visible test inputs are distinct from hidden answer keys.
- Keep evaluation material out of ordinary retrieval; keep held-out acceptance material out of debugging and training. Directory names alone do not provide access isolation.
- Record actual inputs, configuration, outputs and failures when execution occurs. Planned tests remain unrun; mocks do not demonstrate Qwen performance.
- Agree criteria before judging the relevant task's results. Leave unresolved criteria explicit; no shared passing score, fixed question count or global threshold is set now.
- Training methods/exercises follow analysed test results. Training execution needs a defined method, permitted dataset, environment, budget, evaluation arrangement and owner authorisation.

## Paths and configuration

Team paths are relative to each contributor's checkout. Owner-specific source paths belong in ignored local configuration; the physical locator is documented once in `data/README.md`. Shared examples have no active source or private-evaluation path by default.

`config/data_locations.example.json` is a path registry template, not an automatic resolver for historical scripts. Owner tasks using those scripts must check their explicit inputs/paths. Missing owner configuration does not block test drafting.

`config/execution_policy.json` retains the machine-readable restrictions. No server connection, deployment, system/model test or training run is claimed by this documentation update.
