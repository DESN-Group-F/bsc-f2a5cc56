# GitHub collaboration

Repository: https://github.com/qwerty1218171-creator/bsc (private).

This private repository is the shared home for authored project material. Git is used for code and reviewable project records; it is not the data store for the source workspace or prepared payloads.

## Repository scope

Include:

- authored source code and processing scripts, including `data_preparation/**/*.py`;
- contracts, schemas, configuration examples, task plans and backlog definitions;
- concise reports, decisions and validation summaries placed in the reviewed `docs/` or `reports/` areas and containing no source text;
- final PDFs under `reports/**/output/pdf/`;
- the lean catalogues in `data/catalogue/`.

Exclude:

- the original workspace at `E:/desn 2000/data/battery_data_workspace_v0_3`;
- lithium source captures under the accepted coverage run's `products/sources/`, `background/sources/` and `audits/quarantine/` directories;
- all historical `data_preparation/` outputs by default, including extracted text, facts, audit excerpts, large experimental profiles or subsets, native binary data and generated indexes; only reviewed authored `*.py` scripts are excepted;
- quarantined or copy-controlled material;
- virtual environments, caches, temporary renders and report build intermediates;
- machine-local configuration, credentials, tokens and private evaluation answers.

Git LFS is not used. A file being small enough for Git does not make it eligible. Source permission, local processing, RAG admission, training, redistribution and server transfer remain separate decisions.

## Local data setup

1. Clone the private repository.
2. Copy `config/data_locations.example.json` to `config/data_locations.json` and record paths for the local machine. The destination file is ignored by Git. This is currently a path registry only: historical processing scripts retain their original machine/run paths and do not automatically load it.
3. Obtain source or prepared data through the separately approved team channel. A clone does not download or reconstruct local data.
4. Use `data/catalogue/source_objects.jsonl` to match the 300 original objects by source ID, relative path, registered hash and byte count.
5. Use `data/catalogue/lithium_supplement_sources.jsonl` to locate the later lithium source captures. Its failed and quarantined entries remain excluded from use.

The accepted prepared artifacts remain local under `data_preparation/`. Any later database or RAG build must select inputs through a purpose-specific allowlist and the applicable source-action decisions; do not ingest a directory wholesale.

## Collaboration workflow

- Keep `main` as the reviewed integration branch and create a short-lived branch for each bounded change.
- Keep commits focused and describe changed files, checks run, and any unresolved limitation.
- Review changes through a pull request before merging to `main`.
- Do not add generated payloads merely to make another machine reproduce a local run. Share approved data separately and verify it against the catalogue hashes.
- Never commit a real `.env`, `config/data_locations.json`, server configuration, secret-bearing manifest or private oracle.

This repository setup does not start T00, a database, RAG, Qwen, model evaluation or server work. Those actions remain controlled by `docs/LOCAL_SERVER_EXECUTION_BOUNDARY.md` and `config/execution_policy.json`.

## Pre-commit review

Before each commit, review the proposed file list for unexpected binaries, source captures, extracted text, historical run outputs, personal machine paths, credentials or private answers. Confirm that any data catalogue contains metadata only and that final report PDFs are intentional.
