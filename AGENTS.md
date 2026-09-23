# BSC project instructions

## Current team arrangement

The current user request takes precedence over older plans. Read `docs/TEAM_PROJECT_GUIDE.md` and follow the assigned task. `PROJECT_START.md` is the portable entry point for contributors and their AI assistants.

1. **Data and database:** the project owner is responsible for data preparation, processing-method selection, database/retrieval construction, analysis tools and the first database-plus-Qwen integration. AI performs most detailed execution under that ownership.
2. **Test preparation:** teammates can start now, alongside database development. AI helps draft comprehensive database-access, evidence, tool and real scientific/engineering capability tests. People review questions, reference answers, evidence and eventual results. No teammate must inspect the full source collection or implement a data-processing lane.
3. **Training preparation:** use actual test failures to propose improvements, training methods and exercises where justified. Missing data, retrieval failures and tool defects are not automatically model-training problems. Training execution remains a separate decision.

People own tasks and accept results. AI tools assist execution; do not name them as project members, assignees, approvers or deliverers in current team documents. Use English for current team instructions and deliverables. Historical records may retain their original language and provenance.

There is no project-wide score threshold, universal pre-Qwen checklist, mandatory kickoff agenda or fixed allocation of people. Agree scope and acceptance criteria for each task during collaboration, before judging its results. Leave unresolved criteria explicit.

Processing-method research belongs to the owner. The future information-type by file-format matrix and assessment of mature existing solutions are deferred owner work, not assignments for the testing team. No RAG, SQL or other processing platform is selected by this documentation change.

## Portable collaboration

- Use each contributor's own checkout and repository-relative paths. Share reviewable changes through the private GitHub repository, not by requiring teammates to write onto the owner's computer.
- Test authors do not need the owner's disk, a full raw-source download or private evaluation directory. Use product requirements and supplied case inputs; record missing fixtures for the owner to resolve.
- `data/README.md` holds the portable raw-source layout and prepared-data locator. `config/data_locations.example.json` is an optional registry for database work; machine-specific paths belong in the ignored `config/data_locations.json`.
- Historical processing scripts retain some original run paths and do not automatically load the registry. Check scope and inputs before executing any of them.
- Keep originals read-only and frozen runs unchanged. Do not scan unspecified directories, follow junctions/symlinks or repeat a full inventory/hash audit. Write new derived outputs to the configured project workspace.
- The private repository includes the explicitly approved original source collection and lithium supplement under `data/raw/` via Git LFS. Fetch only files needed for an assigned task. Keep extracted text, experimental/derived payloads, secrets, machine settings and hidden final-acceptance answers out of Git. Repository presence grants no RAG, training, redistribution or server-transfer approval.

## Execution and source-use scope

Read `docs/LOCAL_SERVER_EXECUTION_BOUNDARY.md` and `config/execution_policy.json` before execution. Their operational restrictions do not block teammates from drafting tests and reviewing documents on their own computers.

The current execution stage remains `LOCAL_CONTROLLED_DATA_PROCESSING`. T00, target database/RAG deployment, Qwen inference, model performance evaluation, large embeddings, server access and fine-tuning have not been started by the preparation or collaboration work. Do not start them automatically from an old plan. Follow the owner's concrete work order and the applicable execution scope.

Local documentation, implementation drafts and test design are allowed. Authorised data inspection, extraction, conversion and bounded analysis may include parsing/conversion tests, field-contract checks, numerical checks and temporary-file/database queries. Report only checks actually run and their exact scope; they are not server acceptance or model scores. Do not run the inherited handoff suite for a documentation task.

Source access, local processing, indexing/model-context use, redistribution, server transfer and training are separate permissions. Unknown or denied RAG status does not by itself prohibit a supported local inspection; local extraction grants no additional uses. Resolve the source/version and concrete action from existing evidence instead of rebuilding the entire rights audit.

For authorised processing, calibrate each new format/structure on a bounded sample, check critical content, then continue the eligible batch. Sampling alone is not proof of collection-wide coverage. Prefer existing dependencies; do not alter system or source-workspace environments.

## Tests and improvement

- Design cases against intended behaviour, including successful ordinary tasks, complex reasoning, data access, citations, calculations, missing/conflicting inputs and case updates. Drafting does not depend on a final platform or API.
- AI-written questions and answers are proposals until reviewed. Use independent references/calculations where possible; AI agreement alone is not validation. Record uncertain answers explicitly.
- Development cases can support debugging. Held-out acceptance cases and keys stay separate from debugging, training and ordinary retrieval. A folder in a shared repository does not provide access isolation.
- Do not open historical private test questions/answers without an assigned task requiring that access. Never index evaluation material into ordinary RAG.
- When execution is authorised, retain actual inputs, configuration, outputs and failures. Plans, schemas, mocks and fixtures do not prove Qwen or system performance.
- Diagnose data, retrieval, tools, instructions and model behaviour separately. Training proposals follow observed needs; training execution, dataset use and budget remain separately scoped. Do not automatically turn test answers or logs into training data.

## Product requirements

Support evidence-based battery analysis from case descriptions, uploads, applicable records and bounded physical, chemical and engineering tools. Lithium batteries are the main application. General analysis plus case-time product/site inputs remains the product approach; labels and storage volume do not establish complete coverage.

Distinguish reported observations, measurements, calculations, hypotheses and unknowns, retaining source, revision, units, conditions and time. Cross-institutional practices can inform analysis but do not automatically become UNSW procedures or local approval. Missing a matching case does not prohibit bounded professional explanation.

C1/C2/C3/C4 concern applicability, not danger levels. Retrieval failure is `UNDETERMINED`. Do not invent exact risk probabilities, time-to-failure, units, citations, tool results, approvals or device actions. Predictions require an applicable validated method.

Emergency information must be available independently of the model. Do not ask someone to remain exposed or gather hazardous evidence before seeking help. Unconfigured contacts stay unconfigured.

Use allowlisted analysis tools; no model access to arbitrary shell, SQL, Python, URLs or files. Analysis records do not execute real business actions. Keep application logic responsible for actual execution status, permissions and audit records.

Preserve actual model identity, revision, template and effective parameters. The requested model is `Qwen/Qwen3.8-27B`; its loaded service has not been verified in these runs. Never silently substitute a model or present a mock as Qwen. The user reported earlier model tests: do not invent their scores or claim no prior tests occurred.

## Preparation evidence and history

Accepted local runs remain under `data_preparation/`: `CR-DATA-READY-001/20260920T012405_AEST`, `CR-DATA-CANDIDATE-001/20260920T045258_AEST`, and `CR-LITHIUM-COVERAGE-001/20260921T043456_AEST`. A clone includes their reviewed scripts, not their data payloads.

The candidate correction resolved 207 records: 92 source-bound parameters/conditions/rules and 115 other semantic roles. It corrected those interpretations, not permissions. The current view has 673 records; the other 466 were not comprehensively re-audited in that correction.

The lithium increment has 42 product records/174 fact fields and a 40-record/164-field selection for conditional future local structured-fact queries. The 66 merged exact labels span product levels and are neither a market census nor an ingestion allowlist. Preserve Molicel restrictions, the ULRI exclusion and failed Panasonic HTML exclusion.

Remaining gaps include product operating conditions, exact LMO models, named light-mobility systems, special chemistries and case/site inputs. Some units are undeclared and one copy-controlled summary remains unparsed. Consult existing source-action evidence rather than upgrading eligibility from completion labels.

Older implementation plans, LP/T backlogs, CR cards and reports are background, not the current team queue or acceptance gates. Do not restart stale `IN_PROGRESS` entries. See `backlog/README.md`. Frozen evidence and Git history preserve previous decisions.

For bounded delegated work, follow the user's preference for Sol with concise, independent assignments. The coordinator reviews results. Report actual changes/checks and unresolved issues honestly; never conceal uncertainty.
