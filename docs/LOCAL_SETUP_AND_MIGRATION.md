# Contributor setup and later runtime handoff

## Teammates preparing tests

Clone the private repository wherever convenient. Read `docs/TEAM_PROJECT_GUIDE.md` and `evaluation/README.md`, then work on the agreed task using relative paths.

You do not need to download the source collection or access the owner's drive layout, database or model endpoint to draft cases. Use supplied fixtures or explicitly stated inputs; record missing evidence for the owner. AI may draft questions and answers; people review evidence and accept the work.

Submit reviewable changes through GitHub. Keep hidden final-acceptance answers outside the shared repository. No source-data download, environment installation or server connection is required by this guide. If a task needs an original, follow the selective LFS instructions in `data/README.md`.

## Project owner: data and database

The approved original sources are shared under `data/raw/` through Git LFS. Prepared and derived payloads remain owner-managed outside Git. The locator is in `data/README.md`; `config/data_locations.example.json` is an optional template for ignored local settings. Shared examples use repository-relative raw roots.

Historical processing scripts retain original run paths and do not automatically load that registry. Check their inputs for an assigned execution task. Preserve originals and frozen runs, and write new outputs to the configured workspace.

Processing-tool and database/retrieval choices will be assessed separately. Older architecture/server-command documents describe proposals, not an installed system or assignments for teammates.

## Later runtime handoff

The owner will provide the selected fixtures or interface for the first integrated database-plus-Qwen tests. Confirm the execution environment, model identity, input permissions, secret handling, costs and result location for that task under `LOCAL_SERVER_EXECUTION_BOUNDARY.md`.

Transfer only selected, authorised manifests to a runtime or model service. Keep source data, development cases, private acceptance material and future training data separate. The approved private-repository archive is distinct from any server transfer.

Retain actual commands, relevant versions, inputs, outputs and failures. Share reviewable results through the agreed project channel; contributors do not have to write onto the owner's computer. Agree acceptance criteria for each task during collaboration.
