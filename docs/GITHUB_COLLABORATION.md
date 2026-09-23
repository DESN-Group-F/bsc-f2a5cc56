# GitHub collaboration

Repository: https://github.com/DESN-Group-F/bsc-f2a5cc56 (private).

Each member works in their own checkout, creates a focused branch and submits changes through a pull request to `main`. Use repository-relative paths in issues, documentation and reviews so instructions work across machines.

## What belongs in the repository

Include:

- authored source code and processing scripts;
- contracts, schemas, configuration examples, task definitions and reviewed documentation;
- test specifications and public fixtures that do not reveal held-out answers;
- concise reviewed reports and intentional final PDFs;
- source catalogues and the explicitly approved original collection and lithium supplement under `data/raw/`, stored with Git LFS.

Exclude:

- extracted full text, historical run payloads, large experimental derivatives and generated dataset indexes;
- derived quarantined material outside the approved raw-source archive;
- virtual environments, caches and temporary renders;
- machine-local configuration, credentials and tokens;
- private evaluation prompts, expected answers, scoring notes or final-acceptance evidence.

Use a skip-smudge clone and fetch only needed LFS paths; [the data guide](../data/README.md) records the layout and transfer manifest. The source archive includes status-marked failed and quarantined captures for traceability. File size or repository presence does not decide evidence eligibility. Source access, local processing, RAG admission, training, redistribution and server transfer remain separate decisions.

## Team workflow

1. Pull the latest `main` into your own checkout.
2. Create a short-lived branch for one bounded change.
3. Keep commits focused and describe the user-visible intent, evidence used, checks performed and remaining uncertainty.
4. Open a pull request for human review before merging.
5. Resolve review comments without adding local data merely to reproduce the owner's environment.

Human team members own contributions and reviews. AI may assist with implementation, drafting and analysis, but it is not listed as a project owner, assignee or byline.

## Data and test work

The raw archive upload is complete. Test authors can fetch selected source files through LFS to support cases and expected answers, alongside requirements, observable behaviour and approved summaries. Keep each source ID, repository path, citation and status with the test; a failed or excluded capture is not usable evidence. When a first build exists, tests should also use its documented interfaces.

The local data map and path registry are for the owner/build stream. Historical scripts may retain old machine paths; team instructions should not depend on them. Any later database, retrieval or training input must be selected through the applicable source-use decision and a purpose-specific manifest rather than a whole directory.

Keep held-out evaluation material separate from normal retrieval and training inputs. Public test structure may be reviewed in Git; private expected answers and final acceptance evidence stay outside the ordinary build context.

## Before merging

Review the changed-file list for unexpected binaries or source captures outside the approved `data/raw/` archive, extracted text, historical payloads, personal paths, credentials or private answers. Confirm that test changes describe status honestly: drafted cases are not executed tests, mock output is not Qwen output, and no build is called accepted without its actual review evidence.
