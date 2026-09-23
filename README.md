# BSC Model Core

Private collaboration repository: https://github.com/DESN-Group-F/bsc-f2a5cc56

BSC is preparing an evidence-based battery and engineering analysis system. The project owner leads data preparation, processing-method selection and the future database, retrieval, tools and Qwen integration. Other team members develop the test suite in parallel from user requirements and observable behaviour, then review expected answers, evidence and results.

## Current status

Bounded data preparation has been completed for the accepted historical runs. The first database/retrieval/tool/Qwen build does not yet exist, and no current test result should be read as acceptance of that future build.

The prepared coverage includes a large experimental corpus and a lithium-product increment, with known gaps retained. Team members do not need the raw corpus to draft tests or review user-facing requirements.

## Start here

1. [Team project guide](docs/TEAM_PROJECT_GUIDE.md) - current roles, collaboration model and evidence discipline.
2. [Project start](PROJECT_START.md) - agent onboarding and current task boundaries.
3. [Evaluation guide](evaluation/README.md) - how to draft the comprehensive test suite before runtime execution.
4. [GitHub collaboration](docs/GITHUB_COLLABORATION.md) - checkout, branch, pull-request and repository-data rules.
5. [Execution boundary](docs/LOCAL_SERVER_EXECUTION_BOUNDARY.md) and [execution policy](config/execution_policy.json) - authoritative constraints for build or model execution.

## Repository contents

A clone contains authored code, processing scripts, contracts, configuration examples, plans, reports and source catalogues. The original source collection and lithium supplement are stored under `data/raw/` using Git LFS. A skip-smudge clone holds pointers until a contributor explicitly fetches selected files; test authors need not download the collection. The repository still excludes extracted full text, prepared/experimental derivatives, secrets and private evaluation answers. See [the data guide](data/README.md) for the source layout and selective retrieval.

The owner/build stream may use [the data map](data/README.md) and the path registry as build background. They are not required for test drafting or an automatic runtime interface.

`IMPLEMENTATION_PLAN.md`, detailed technical documents, historical preparation runs and reports are background references. They preserve design ideas and evidence, but they are not the current team allocation, a fixed implementation choice or proof that the planned system has been built. Current team instructions are in English; historical material is not promised to be translated.

Do not treat Git availability as permission for RAG, training, redistribution or server transfer.
