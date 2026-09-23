# Evaluation and test-suite work

A comprehensive test suite is being prepared in parallel with the first system build. Test design starts from user requirements and observable behaviour, not from an assumed database, retrieval library or processing platform.

The existing `scenario_specs.jsonl` contains 26 inherited design scenarios. They have not been run against the future build, reviewed as a complete professional gold set or accepted as final coverage. Keep those records unchanged and treat them as background inputs to the broader suite.

## What to draft

Develop representative tests for:

- database access, identity, revision and provenance;
- exact lookup and evidence retrieval, including citations, permissions and no-result states;
- data-reading and calculation tools, including units, assumptions, invalid inputs and warnings;
- real Qwen physics, chemistry and engineering reasoning;
- product, laboratory and lifecycle cases that distinguish facts, calculations, interpretations and unknowns;
- integration failures, unsupported requests and clear escalation or missing-input behaviour.

A test specification should state the user need, inputs, expected observable behaviour, supporting evidence and how to judge the result. Criteria may be qualitative or quantitative as appropriate to the task; there is no universal threshold for every test.

## Review and execution

Review cases, expected answers and evidence before they become acceptance material. Runtime execution begins when a first build is available. Until then, cases remain `DEFINED_NOT_RUN` or an equivalent clearly unexecuted status.

Real Qwen runs must record the actual model identity and configuration. Mock or component tests remain distinct from model results. Recorded test outcomes require actual execution and the agreed checking method; task acceptance is a separate judgment. Review depth and scoring are agreed per task, without requiring every generated case or result to be inspected manually.

## Isolation

Keep final acceptance prompts, expected answers, scoring notes and private evidence held out from ordinary retrieval and training inputs. Public test schemas and non-secret fixtures may live in the repository. If failures later motivate practice or training material, prepare that material separately and do not copy held-out final answers into it.

For an evidence-based case, retrieve only relevant archived originals through selective Git LFS and record each source ID, repository path, citation and status. Check exclusions and source-use conditions before relying on a capture. A full raw-source download is unnecessary for test drafting; a reviewed fixture or the future documented interface may also supply case evidence.
