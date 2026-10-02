# Proposed evaluation protocol

Prepared 1 October 2026; updated for shared staff scope 2 October 2026. This is a proposed study, not measured evidence.

## Research question

Does the staff-operated prototype reduce routine battery-management effort while preserving correct responsibility and traceability?

Hypothesis H1: the prototype reduces completion time and repeated data entry for checkout, return and tracing tasks.

Hypothesis H2: duplicate identifiers, interrupted requests and corrections do not create misleading inventory state.

Software tests support H2 within their tested cases. H1 remains untested, and real RFID performance is a separate experiment.

## Establish the baseline

Observe the stakeholder's current method, including informal steps outside a spreadsheet or register. Record how a staff member identifies a battery, records responsibility, processes returns and investigates an unaccounted-for asset. Do not invent a baseline from assumptions.

Use fictional people and batteries for the controlled study. Record participant consent and collect only task data needed for the comparison. Start with the stakeholder and, if available, a small group of other staff; report the sample and its limits.

## Paired tasks

| Task | Scenario | Correct outcome |
| --- | --- | --- |
| T1 | Check out three batteries to one borrower | Three active loans; owner unchanged |
| T2 | Return two batteries borrowed by different people | Both closed; history retained |
| T3 | Find the borrower and last observation of a named battery | Correct borrower plus room/time/source or explicit unknown |
| T4 | Enter a duplicate and an unknown identifier | No duplicate loan; clear unresolved identifier |
| T5 | Correct a mistaken return | Loan reopened with a recorded reason |
| T6 | Add a battery with unknown specifications | Correct owner/home; no fabricated values |
| T7 | Filter a location and download a summary, then selected detailed histories | Correct filter scope, counts, sections and complete stored evidence |
| T8 | Two staff attempt to lend the same battery | One valid loan; losing attempt explains conflict without partial saving |

Give a short consistent orientation. Counterbalance whether participants use the current method or prototype first. Use equivalent task sets, reset fictional state between trials and keep the same hardware/network conditions.

Record time from task start to correct saved result, errors, number of repeated typed fields, help requests and steps spent recovering. Record task abandonment as a failure rather than omitting it. After each condition, ask which step created avoidable work and whether the result was understandable.

## Analysis and decision

Report per-task paired differences, median time, range, error counts and recovery effort. With a small pilot, treat results as descriptive; do not claim population significance. Proposed success criteria are faster routine tasks without worse accuracy or recovery effort, subject to stakeholder agreement before the study.

If the interface adds work, revise the slow step and repeat the affected comparison. A visually attractive dashboard alone is not evidence of success.

## RFID experiment after device selection

Create a ground-truth room inventory and test representative single/packed batteries, storage cabinets, adjacent rooms and doorway transitions. Repeat conditions at documented reader settings. Measure correctly identified tags, missed reads, duplicate packets, incorrect room attribution, latency and stale/conflicting observations.

Agree acceptance thresholds with the stakeholder after understanding operating conditions. Preserve raw anonymized outputs, configurations and results. Do not extrapolate a desk test to the real storage environment.

## Record structure

Store approved protocols and results under docs/; keep raw local trial data and screenshots under ignored work/qa/. Version requirements when the evidence changes. Keep observations, interpretations and design decisions distinguishable.
