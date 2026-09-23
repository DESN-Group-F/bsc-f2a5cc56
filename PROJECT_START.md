# Start an assigned project task

Read [the team guide](docs/TEAM_PROJECT_GUIDE.md) and [the project instructions](AGENTS.md). The current task defines scope; older plans are background, not a queue to execute automatically.

## Relevant workstream

- **Data and database:** the project owner coordinates this work with AI. Processing-method selection and implementation remain within this workstream.
- **Test preparation:** teammates can draft cases now with AI, then review questions, evidence and expected results. Cover database/tool behaviour and Qwen's scientific and engineering capabilities. No full copy or manual review of the source collection is required.
- **Training preparation:** use actual test failures to propose methods and exercises where justified. Do not begin training or reuse held-out answers from this entry point.

## Your own checkout

Use relative paths and submit reviewable changes through the repository. No task requires access to the project owner's computer. For test design, select relevant archived sources yourself and record their source ID, path, citation and status. Describe evidence still missing so the owner can resolve it.

Original source files are available in the approved private raw-source archive and can be retrieved selectively through Git LFS under `data/raw/`; test drafting does not require downloading or reviewing the full collection. See [the data guide](data/README.md). Repository access alone does not approve a source for retrieval context, training or server transfer.

AI can draft and implement most of a task. A human reviews evidence, resolves uncertain answers and accepts results. Agree task-specific criteria during collaboration; no universal threshold or predefined kickoff checklist applies.

For test work, continue with [the evaluation guide](evaluation/README.md). For code/data execution, check [the execution scope](docs/LOCAL_SERVER_EXECUTION_BOUNDARY.md). Drafting a test is different from running a model, database or server job.

Keep the handoff concise: what changed, what was actually checked, what remains uncertain and what the next task depends on. Do not invent results or approvals.
