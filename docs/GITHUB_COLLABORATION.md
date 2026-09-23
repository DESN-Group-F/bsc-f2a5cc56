# GitHub collaboration

Repository: https://github.com/qwerty1218171-creator/bsc (private).

Each member works in their own checkout, creates a focused branch and submits changes through a pull request to `main`. Use repository-relative paths in issues, documentation and reviews so instructions work across machines.

## What belongs in the repository

Include:

- authored source code and processing scripts;
- contracts, schemas, configuration examples, task definitions and reviewed documentation;
- test specifications and public fixtures that do not reveal held-out answers;
- concise reviewed reports and intentional final PDFs;
- metadata-only catalogues approved for collaboration.

Exclude:

- the owner's raw corpus and lithium source captures;
- extracted full text, historical run payloads, large experimental data and generated dataset indexes;
- quarantined or copy-controlled material;
- virtual environments, caches and temporary renders;
- machine-local configuration, credentials and tokens;
- private evaluation prompts, expected answers, scoring notes or final-acceptance evidence.

Git LFS is not used. File size alone does not decide eligibility. Source access, local processing, RAG admission, training, redistribution and server transfer remain separate decisions.

## Team workflow

1. Pull the latest `main` into your own checkout.
2. Create a short-lived branch for one bounded change.
3. Keep commits focused and describe the user-visible intent, evidence used, checks performed and remaining uncertainty.
4. Open a pull request for human review before merging.
5. Resolve review comments without adding local data merely to reproduce the owner's environment.

Human team members own contributions and reviews. AI may assist with implementation, drafting and analysis, but it is not listed as a project owner, assignee or byline.

## Data and test work

The raw corpus remains with the project owner and is not needed to draft tests. Test authors work from user requirements, observable behaviour, approved summaries and evidence supplied for the case. When a first build exists, tests should use its documented interfaces rather than direct access to the owner's folders.

The local data map and path registry are for the owner/build stream. Historical scripts may retain old machine paths; team instructions should not depend on them. Any later database, retrieval or training input must be selected through the applicable source-use decision and a purpose-specific manifest rather than a whole directory.

Keep held-out evaluation material separate from normal retrieval and training inputs. Public test structure may be reviewed in Git; private expected answers and final acceptance evidence stay outside the ordinary build context.

## Before merging

Review the changed-file list for unexpected binaries, source captures, extracted text, historical payloads, personal paths, credentials or private answers. Confirm that test changes describe status honestly: drafted cases are not executed tests, mock output is not Qwen output, and no build is called accepted without its actual review evidence.
