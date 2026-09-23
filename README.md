# BSC Model Core

Private collaboration repository: https://github.com/DESN-Group-F/bsc-f2a5cc56

BSC is a group project to build an evidence-based battery and engineering analysis system. The work covers data preparation, processing methods, databases, retrieval, analysis tools and Qwen integration. Test design and review proceed in parallel from user requirements, source evidence and observable behaviour. Improvements follow diagnosed test results.

## Current status

Bounded data preparation has been completed for the accepted historical runs. The first database/retrieval/tool/Qwen build does not yet exist, and no current test result should be read as acceptance of that future build.

The raw-source archive upload is complete: 300 original objects and 18 lithium-supplement captures, totalling 112.48 GB (112,476,007,760 bytes), are stored through Git LFS. This gives the team direct access to experimental data and lithium-product references for evidence-based test design. Known coverage gaps remain; upload completion refers to the registered collection.

## Start here

1. [Team project guide](docs/TEAM_PROJECT_GUIDE.md) - project work, collaboration and evidence.
2. [Project start](PROJECT_START.md) - task setup and current scope.
3. [Evaluation guide](evaluation/README.md) - how to draft the comprehensive test suite before runtime execution.
4. [GitHub collaboration](docs/GITHUB_COLLABORATION.md) - checkout, branch, pull-request and repository-data rules.
5. [Execution boundary](docs/LOCAL_SERVER_EXECUTION_BOUNDARY.md) and [execution policy](config/execution_policy.json) - authoritative constraints for build or model execution.

## Repository contents

A clone contains authored code, processing scripts, contracts, configuration examples, plans, reports and source catalogues. The original source collection and lithium supplement are stored under `data/raw/` using Git LFS. A skip-smudge clone holds pointers until a contributor fetches selected files; teammates can retrieve relevant sources without downloading the full collection. The repository still excludes extracted full text, prepared/experimental derivatives, secrets and private evaluation answers. See [the data guide](data/README.md) for the source layout and selective retrieval.

For database work, [the data map](data/README.md) and path registry describe archive and prepared-data locations. They are not required for test drafting or an automatic runtime interface.

`IMPLEMENTATION_PLAN.md`, detailed technical documents, historical preparation runs and reports are background references. They preserve design ideas and evidence, but they are not the current team allocation, a fixed implementation choice or proof that the planned system has been built. Current team instructions are in English; historical material is not promised to be translated.

Do not treat Git availability as permission for RAG, training, redistribution or server transfer.
