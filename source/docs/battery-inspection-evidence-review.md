# Battery inspection evidence review

Reviewed 2 October 2026. Research note for discussion; no inspection workflow or frequency has been approved or implemented.

## Finding

The reviewed primary sources provide useful inspection content and several specific triggers. They do not establish a universal calendar interval for every battery in this project. The proposed initial seven-day deadline and thirty-day repeat interval therefore remain unadopted.

The project team should prepare the operating design from applicable evidence. Staff should not be asked to invent it. The actual battery chemistries, models, manufacturer instructions, usage and storage arrangements still need to be established. Most evidence below concerns lithium-ion or lithium-polymer batteries; it must not automatically be extended to every chemistry.

## Source findings and applicability

| Primary source | What it actually supports | Frequency and limitation |
| --- | --- | --- |
| [UNSW battery handling guidance](https://www.inside.unsw.edu.au/campus-culture/make-sure-you-handle-batteries-safely), 17 August 2026 | Regular condition checks; recognition of damage and swelling; appropriate charging and storage practices | No numerical inspection interval. This local source takes priority over treating another university's practice as a UNSW requirement. |
| [UNSW general lithium-ion battery safety alert](https://www.unsw.edu.au/content/dam/pdfs/unsw-adobe-websites/planning-assurance/safety/alerts/2023-09-safety-alerts/2023-10-General-Lithium-Ion-Li-ion-battery-Safety-alert-September-2023.pdf), September 2023 | Battery warning signs and device-specific instructions; manufacturer guidance for storage | No universal calendar interval. It does not validate seven-day or thirty-day deadlines. |
| [Monash LiPo hazard alert](https://www.monash.edu/__data/assets/pdf_file/0005/2922341/HA-LiPolymer-Batteries.pdf), March 2017 | Local safety arrangements for charging, regular inspection and disposal; checking for damage or swelling | No numerical interval. This is an older, LiPo-specific alert, not evidence of a current UNSW policy. |
| [Iowa State EHS battery safety](https://www.ehs.iastate.edu/battery-safety), publication date not displayed | Condition checks before each use, supported by manufacturer information and a written experimental protocol | An event-triggered check, not a requirement to inspect the whole register every few days. |
| [University of Washington lithium battery safety](https://ehs.washington.edu/system/files/resources/lithium-battery-safety.pdf), current downloaded revision January 2026, pages 1-2 | Inspection on receipt and before use; visual inspection of storage areas; separate maintenance of stored batteries | Storage areas at least weekly. Stored-battery charge maintenance at least every six months. These are different tasks; neither defines a universal per-battery technical inspection cycle. |
| [MIT lithium battery checklist](https://ehs.mit.edu/wp-content/uploads/2019/09/Lithium_Battery_Checklist.pdf), one page, printed revision date not displayed | A real checklist organized into general practice, charging, storage and disposal | Useful evidence that prepared checklists exist. It is not a universal repeated inspection form or a source for one calendar interval. |
| [University of New Hampshire T2 lithium battery briefing](https://t2.unh.edu/sites/default/files/media/2025-11/Tailgate%20Talk-%20Lithium%20Batteries.pdf), pages 1-3, printed publication date not displayed | Before-use checks of batteries and chargers; more detailed monthly inspection of high-use batteries | Intended for public-works tools and field/shop use. Its monthly advice does not justify applying thirty days to every laboratory battery. The document identifies itself as general guidance that does not replace manufacturer instructions or professional assessment. |

The Washington wording explicitly addresses storage areas rather than individual batteries. Its separate six-month provision concerns storage charging, not a declaration that batteries need no attention for six months. Charge targets and procedures are not adopted here; they require chemistry- and model-specific verification. The New Hampshire source does not define a numerical threshold for high use, so the software cannot invent one and claim source compliance.

## What can be checked

The following categories summarize relevant content, not an approved operating procedure:

| Target | Candidate observations | Evidence and scope |
| --- | --- | --- |
| Battery exterior and behaviour | Deformation or swelling, damaged casing, leakage, discoloration, and reported abnormal heat, sound or odour | UNSW identifies these warning signs. Observing them must not be turned into instructions to touch a hot battery or approach it to smell it. |
| Charger and visible connections | Damaged leads or plugs, loose or distorted contacts, and use of equipment intended for that battery | New Hampshire describes these inspection points; its equipment context still matters. |
| Storage or charging area | Nearby combustibles, heat or moisture exposure, suitability of the location and protection from accidental short circuits | UNSW, Monash and Washington discuss environmental controls. Record this at the area level rather than repeating identical answers on every asset. |
| Battery performance or internal health | Only measurements specified by an applicable manufacturer or approved technical procedure | The common external observations above do not constitute capacity, internal-resistance, cell-balance or BMS tests, and do not certify internal health. |

Inventory identity, owner and location reconciliation can be valuable administrative work. They are separate from condition inspection and should not be relabelled as a safety requirement merely to justify frequent reminders.

## Consequences for the proposed product

These are design recommendations inferred from the evidence and the workload objective, not rules quoted from a university:

1. Keep the inspection feature pending. Do not enable a universal seven-day or thirty-day task generator.
2. Distinguish checks associated with receipt, use or charging; location-level inspection; and model-specific scheduled maintenance. Each needs its own target and completion evidence.
3. Reuse normal handling opportunities where an applicable procedure allows it. A checkout is not proof that a physical check happened, and it cannot stand in for a later pre-use check.
4. Evaluate an accessible issue-reporting action and concise guidance before imposing a separate form for every normal interaction. Whether a normal check requires a saved record must follow applicable procedure; do not manufacture passing records from inventory movements.
5. When a periodic task is justified, store the source, revision, applicable batteries or location, interval or triggering event, required action, and next-due calculation. A change to an email schedule must not change the inspection requirement.
6. Group reminders around genuine outstanding work. A room or storage-area task should not become dozens of duplicate per-battery tasks.

## Verification and remaining limits

This is a targeted review of public university material, not an exhaustive standards search or a substitute for manufacturer documentation. A university-issued checklist does not automatically govern a different institution or battery system. No unavailable internal procedure or permission-protected text was used as evidence.

The current Washington PDF and MIT checklist were downloaded and visually inspected. Washington's direct download was January 2026 with seven pages, while the web extraction returned a July 2025 six-page version; this note uses the direct download. Source hashes and review copies are retained in ignored local QA material. The New Hampshire text was verified through the web reader; a separate local download failed certificate validation, so no local visual-verification claim is made for that file.

Next evidence needed is the actual battery model and chemistry list, the associated manufacturer manuals and any existing local laboratory procedure. The project team can then prepare a short applicability matrix and operating proposal. Missing evidence is not a reason to delegate the design to the teacher or to choose an arbitrary low or high inspection frequency.
