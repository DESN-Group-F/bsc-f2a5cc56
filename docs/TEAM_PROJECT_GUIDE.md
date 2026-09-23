# BSC team project guide

## Purpose

BSC is intended to help analyse battery and engineering cases from user-provided observations, product and site material, traceable reference evidence, stored records and bounded calculation tools. Lithium batteries are the main application. It should distinguish facts, calculated results, interpretations and unknowns, and use applicable UNSW procedures and case conditions to support recommendations, further checks and escalation.

The first working build has not yet been completed. Existing technical plans, preparation runs and reports are useful background, but they are not the current team allocation or proof that a database, retrieval system, tool layer or Qwen integration already works.

## Current team arrangement

### Project owner and build stream

The project owner is solely responsible for:

- data preparation and source-use decisions;
- selecting processing methods;
- building the database, retrieval, tools and interfaces;
- integrating those components with Qwen;
- coordinating AI-assisted execution and deciding what is ready for team review.

AI will perform most of the implementation and analysis work under the owner's direction. The owner remains accountable for scope, evidence, decisions and delivered results. Implementation choices stay within this workstream; test authors focus on required system behaviour.

### Test and acceptance stream

Other team members coordinate a comprehensive test suite while the owner develops the first build. AI handles most question drafting, answer preparation and checking logic. Humans review coverage, realism, supporting evidence and later the results, at the depth agreed for each task.

The suite should eventually cover:

- database access, record identity, versions and provenance;
- retrieval relevance, citation resolution, permission handling and clear no-result behaviour;
- calculation and data-reading tools, including units, assumptions, invalid inputs and warnings;
- real Qwen physics, chemistry and engineering capabilities;
- end-to-end case reasoning, including what is known, inferred, missing or outside scope;
- failure handling and the separation of system results from model-generated claims.

Tests are drafted from user requirements and observable behaviour, independent of the implementation the owner later chooses. Runtime execution begins when a first build exists. A draft case is not a passed test, and inherited or mock results are not real Qwen results.

### Training improvement stream

Observed test failures may motivate proposals for better methods, worked examples, practice material or training material. The team should first diagnose whether a failure comes from data, retrieval, tools, integration, prompting or model behaviour. Training is proposed only when evidence shows it is warranted; it is not an automatic project stage.

## How the streams work together

Test drafting can proceed alongside the owner's build because it starts from expected behaviour rather than database or retrieval internals. For each bounded task, collaborators refine:

- the user need and representative cases;
- required inputs and observable outputs;
- the evidence needed to support an expected answer;
- the interface between the build and the test;
- task-specific acceptance criteria and review responsibilities.

These details are agreed during collaboration. The project does not impose one universal gate, numeric threshold, kickoff agenda or permanent individual assignment for every task.

No team member needs to inspect the approximately 112 GB source corpus record by record. The originals are shared under `data/raw/` through selective Git LFS retrieval, but test authors can work from requirements, approved summaries, metadata, representative evidence supplied for the task and later the running interface.

## Evidence and evaluation discipline

Keep a small number of distinctions clear:

- source statements, user observations, measurements, calculations and hypotheses are different kinds of evidence;
- a result should retain enough provenance to locate its source, version and conditions;
- missing units, conditions or applicability remain unknown rather than being guessed;
- public availability does not by itself grant permission for RAG, training or redistribution;
- external guidance can inform analysis without becoming a local UNSW procedure;
- a model answer is not a database state, tool execution receipt, approval or safety certificate.

Final acceptance material must remain held out. Evaluation prompts, expected answers, scoring notes and private evidence used to judge final performance must not be placed in ordinary retrieval or training inputs. Training candidates derived from failures should use separately reviewed material and must not expose the held-out answers used for final acceptance.

## Working with AI

AI is an execution aid for implementation, research organisation, test drafting and analysis. Human team members own the work, review evidence, approve expected answers and accept or reject results. Project ownership, review responsibility and contribution records use human names rather than AI bylines or assignments.

## Collaboration

Each member works from their own checkout, creates a focused branch and submits changes through a pull request. Use repository-relative paths in team instructions and reviews. Downloading raw source files and configuring owner-only prepared-data paths are not required for drafting tests. Repository presence grants no additional source-use rights.

Start with:

1. [`README.md`](../README.md) for current status and navigation.
2. [`PROJECT_START.md`](../PROJECT_START.md) for agent onboarding and the current task boundary.
3. [`evaluation/README.md`](../evaluation/README.md) for test-suite work.
4. [`GITHUB_COLLABORATION.md`](GITHUB_COLLABORATION.md) for repository workflow and data exclusions.
5. [`LOCAL_SERVER_EXECUTION_BOUNDARY.md`](LOCAL_SERVER_EXECUTION_BOUNDARY.md) and the active execution policy before running build or model work.

Technical plans, contracts and historical reports remain background references. They are not current team assignments, fixed implementation choices or acceptance gates. Current English instructions govern active collaboration; older material is not promised to be translated.
