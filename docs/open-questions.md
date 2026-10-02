# Open questions and release gates

The items below distinguish confirmed scope from remaining evidence gaps. Empty hardware information is intentional.

| Question | Present evidence | Remaining evidence or next gate |
| --- | --- | --- |
| Tag and reader model | None supplied | Manufacturer/model and supported tag type |
| Reader output | None supplied | A real output sample, timestamps, identifiers and transport |
| Reader use | Staff-operated confirmed | Determine keyboard input, USB API, network gateway or other interface |
| Room discrimination | Room-level target approved | Test adjacent rooms, doors and real storage geometry |
| Metal and packed batteries | Not tested | Read-rate and cross-room false-positive study |
| Reader-to-room mapping | Unknown | Validated detector identity and installation map |
| Target building and storage room | J18 is the enabled target; Demo room and Demo workspace are explicit placeholders; E10/G17 names are disabled references | Teacher confirms actual storage room number/name and placement before operational use; renaming alone does not verify a room |
| Return placement | Optional room selected once per scan session; dated staff/simulated return confirmation kept separately from registered home | Confirm actual selectable J18 rooms; automatic room inference requires a validated fixed-reader mapping |
| Existing records | Format/count unknown | Staff, borrower and room conventions; inventory sample without unnecessary personal data |
| Teacher efficiency baseline | Stakeholder goal reported | Observe and time the actual existing workflow |
| Shared access | Staff/admin roles and shared inventory implemented and tested locally | Confirm authorized staff membership and departmental access approval |
| Existing operational records | Real battery data remains pending; disposable local preview business data was rebuilt | Review actual source records and stable identities before any operational import |
| Concurrent capacity | Independent-account access and contested transactions tested | Actual staff count, inventory/history size, network conditions and load testing |
| Backup and retention | Local pre-change backups and immutable application history | Institution-approved backup/restore, retention and administrator policy |
| School SSO and hosting | No school integration | Institutional ownership, security/IT review and permitted hosting |
| JAGGAER connection | Stakeholder future direction | Approved API contract, access and identity/location mapping |
| Messages and task workflow | Local persistent personal inbox and three task categories implemented; shared view/download, admin configuration, assigned completion and request-driven generation | Review actual local verification in validation.md; stakeholder review and operational data/permissions before use |
| Reminder applicability | Weekly storage-area review, pre-teaching-period reconciliation and applicable six-month storage-maintenance review are provisional | Actual areas, teaching dates, battery models, timing origins and applicable procedures |
| Email and unattended delivery | Email preferences are saved; local Messages evaluate due reminders during authenticated use; no sender, recipient confirmation or unattended scheduler | Authorized sending identity/service, confirmed recipients, continuous host, background timezone scheduling and actual receipt evidence |
| Safety agent | Deferred | User need, trusted data, thresholds and controlled actions |

## Future RFID adapter contract

The [Messages and periodic reminders plan](messages-and-reminders-plan.md) describes the implemented local notification scope and future delivery gates. Email conditions are not yet satisfied; an in-app message or a preview must not be described as an email sent. Local request-driven generation cannot promise a reminder while the computer/server is off or no authenticated request occurs.

The eventual adapter should map a registered tag to an asset and a validated reader to a room, then supply observation time, receipt time and explicit source. Unknown tags/readers, duplicate packets, stale data, clock skew and simultaneous room detections require tested handling.

A passive reader detection alone must never check a battery in or out. The local scan station requires staff to deliberately enter checkout/return mode and supply manual or demonstration input. Continuous mode processes individual eligible inputs; Batch mode requires a final confirmation. Loss of detection must never assert that a battery is missing. Automatic placement and any freshness threshold must be calibrated against real evidence and agreed with the teacher. Simulated workflow success does not establish read recall, held-item isolation or real room accuracy.

## Next decision sequence

1. Stakeholder reviews the working staff workflow.
   Confirm the actual storage room within J18; until then, leave it unspecified or use an explicitly marked placeholder for demonstration.
2. Measure workload against the current method.
3. Obtain tag/reader models and one real output sample.
4. Validate room-level read performance in the actual storage environment.
5. Choose the smallest reliable adapter.
6. Seek institutional approval for hosting, identity and any JAGGAER integration.
