# Evaluation and test-suite work

The team is preparing a comprehensive test suite in parallel with the owner's first system build. Test design starts from user requirements and observable behaviour, not from an assumed database, retrieval library or processing platform.

The existing `scenario_specs.jsonl` contains 26 inherited design scenarios. They have not been run against the future build, reviewed as a complete professional gold set or accepted as final coverage. Keep those records unchanged and treat them as background inputs to the broader suite.

## What to draft

Develop representative tests for:

- database access, identity, revision and provenance;
- exact lookup and evidence retrieval, including citations, permissions and no-result states;
- data-reading and calculation tools, including units, assumptions, invalid inputs and warnings;
- real Qwen physics, chemistry and engineering reasoning;
- product, laboratory and lifecycle cases that distinguish facts, calculations, interpretations and unknowns;
- integration failures, unsupported requests and clear escalation or missing-input behaviour.

A test specification should state the user need, inputs, expected observable behaviour, supporting evidence, and how a human reviewer can decide whether the result is acceptable. Criteria may be qualitative or quantitative as appropriate to the task; there is no universal threshold for every test.

## Review and execution

AI may help draft cases, candidate expected answers and checking logic. Humans review the cases, expected answers and evidence before they become acceptance material. Runtime execution begins when a first build is available. Until then, cases remain `DEFINED_NOT_RUN` or an equivalent clearly unexecuted status.

Real Qwen runs must record the actual model identity and configuration. Mock or component tests remain distinct from model results. Recorded test outcomes require actual execution and the agreed checking method; they are separate from human acceptance of the delivered task. Review depth and scoring are agreed per task, without requiring someone to inspect every generated case or result manually.

## Isolation

Keep final acceptance prompts, expected answers, scoring notes and private evidence held out from ordinary retrieval and training inputs. Public test schemas and non-secret fixtures may live in the repository. If failures later motivate practice or training material, prepare that material separately and do not copy held-out final answers into it.

No raw-source download is required for test drafting, even though originals are available through selective Git LFS retrieval. Evidence needed for a particular test can be supplied as a reviewed fixture or through the future documented interface.
