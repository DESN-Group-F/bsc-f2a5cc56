# BSC Model Core

Private collaboration repository: https://github.com/qwerty1218171-creator/bsc

This repository supports the BSC data-preparation and future system-build work. The active execution policy is v0.3.3 / ADR-EXEC-001 and the current stage remains `LOCAL_CONTROLLED_DATA_PROCESSING`.

## Current status

The bounded local data-preparation work is complete for the accepted runs. The latest lithium increment contains 42 reviewed product records and 174 fact fields; 40 records and 164 fields form an incremental internal-query preparation set. The merged identity view contains 66 exact product labels across cells, modules, racks, packs and kits. These figures do not establish complete market, product-operating or scenario coverage.

No target database, RAG ingestion, Qwen integration, model evaluation, server deployment or training was completed by these preparation runs.

## Start here

1. [Team project guide](docs/TEAM_PROJECT_GUIDE_BILINGUAL.md) — concise bilingual project status and scope.
2. [GitHub collaboration guide](docs/GITHUB_COLLABORATION.md) — what belongs in this repository and the branch/review workflow.
3. [Local data map](data/README.md) — where source and prepared data remain, and how to configure local paths.
4. [Execution boundary](docs/LOCAL_SERVER_EXECUTION_BOUNDARY.md) and [execution policy](config/execution_policy.json) — current allowed and prohibited actions.
5. [Implementation plan](IMPLEMENTATION_PLAN.md) — technical baseline for later stages.

A clone contains authored code, processing scripts, contracts, configuration examples, plans, reports and lean source catalogues. It does **not** contain the 112.42 GB source workspace, lithium-source captures, extracted full text, large experimental derivatives, quarantined material, secrets or private evaluation answers. Use `config/data_locations.example.json` as a registry of intended local paths; cloning the repository does not make local data available. Historical processing scripts still contain their original machine/run paths and do not automatically read this template.

The accepted historical run directories remain under the local path `data_preparation/`. Their source payloads and derived content are intentionally excluded from Git, while reviewed authored `*.py` processing scripts remain eligible. Run summaries stay local unless they are separately reviewed and promoted into `docs/` or `reports/`. Do not treat Git availability as source-use, RAG, training, redistribution or server-transfer permission.
