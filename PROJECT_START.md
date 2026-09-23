# Start an assigned project task

Read [the team guide](docs/TEAM_PROJECT_GUIDE.md) and [the project instructions](AGENTS.md). The current task defines scope; older plans are background, not a queue to execute automatically.

## Relevant workstream

- **Data and database:** prepare data, select processing methods, and build the database, retrieval, tools and first Qwen integration.
- **Test preparation:** draft and review cases, evidence and expected results for database/tool behaviour and Qwen's scientific and engineering capabilities. Test drafting does not require a full copy or manual review of the source collection.
- **Training preparation:** use actual test failures to propose methods and exercises where justified. Do not begin training or reuse held-out answers from this entry point.

## Your own checkout

Use relative paths and submit reviewable changes through the repository. For test design, select relevant archived sources and record their source ID, path, citation and status. Record any missing evidence for follow-up.

Original source files are available in the approved private raw-source archive and can be retrieved selectively through Git LFS under `data/raw/`; test drafting does not require downloading or reviewing the full collection. See [the data guide](data/README.md). Repository access alone does not approve a source for retrieval context, training or server transfer.

Review evidence and uncertain answers before accepting results. Agree task-specific criteria before judging a result; no universal threshold or predefined kickoff checklist applies.

For test work, continue with [the evaluation guide](evaluation/README.md). For code/data execution, check [the execution scope](docs/LOCAL_SERVER_EXECUTION_BOUNDARY.md). Drafting a test is different from running a model, database or server job.

Keep the handoff concise: what changed, what was actually checked, what remains uncertain and what the next task depends on. Do not invent results or approvals.
