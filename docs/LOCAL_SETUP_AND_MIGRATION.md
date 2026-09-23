# Contributor setup and later runtime handoff

## Preparing tests

Clone the private repository wherever convenient. Read `docs/TEAM_PROJECT_GUIDE.md` and `evaluation/README.md`, then work on the agreed task using relative paths.

To draft cases, fetch relevant archived sources selectively when evidence is needed. Keep their source ID, path, citation and status with the case. A full collection download, database or model endpoint is unnecessary for test drafting. Record missing evidence for follow-up, and review questions and answers against their support.

Submit reviewable changes through GitHub. Keep hidden final-acceptance answers outside the shared repository. Follow the selective LFS instructions in `data/README.md` when a task needs an original; no server connection is required for drafting.

## Data and database

The approved original sources are shared under `data/raw/` through Git LFS. Prepared and derived payloads remain outside Git. The locator is in `data/README.md`; `config/data_locations.example.json` is an optional template for ignored local settings. Shared examples use repository-relative raw roots.

Historical processing scripts retain original run paths and do not automatically load that registry. Check their inputs for an assigned execution task. Preserve originals and frozen runs, and write new outputs to the configured workspace.

Processing-tool and database/retrieval choices will be assessed separately. Older architecture/server-command documents describe proposals, not an installed system or assignments for teammates.

## Later runtime handoff

The first integrated database-plus-Qwen tests need selected fixtures or a documented interface. Confirm the execution environment, model identity, input permissions, secret handling, costs and result location for that task under `LOCAL_SERVER_EXECUTION_BOUNDARY.md`.

Transfer only selected, authorised manifests to a runtime or model service. Keep source data, development cases, private acceptance material and future training data separate. The approved private-repository archive is distinct from any server transfer.

Retain actual commands, relevant versions, inputs, outputs and failures. Share reviewable results through the agreed project channel. Agree acceptance criteria for each task before judging its results.
