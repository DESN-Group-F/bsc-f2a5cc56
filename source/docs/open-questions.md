# Open questions and release gates

All items below remain unverified. Empty hardware information is intentional.

| Question | Present evidence | Needed before implementation |
| --- | --- | --- |
| Tag and reader model | None supplied | Manufacturer/model and supported tag type |
| Reader output | None supplied | A real output sample, timestamps, identifiers and transport |
| Reader use | Teacher-operated confirmed | Determine keyboard input, USB API, network gateway or other interface |
| Room discrimination | Room-level target approved | Test adjacent rooms, doors and real storage geometry |
| Metal and packed batteries | Not tested | Read-rate and cross-room false-positive study |
| Reader-to-room mapping | Unknown | Validated detector identity and installation map |
| Return placement | Registered home only | Decide whether room is inferred from a validated fixed reader or selected once per batch |
| Existing records | Format/count unknown | Staff, borrower and room conventions; inventory sample without unnecessary personal data |
| Teacher efficiency baseline | Stakeholder goal reported | Observe and time the actual existing workflow |
| Shared access | Private operator-scoped prototype | Department workspace, authorized roles and access approval |
| School SSO and hosting | No school integration | Institutional ownership, security/IT review and permitted hosting |
| JAGGAER connection | Stakeholder future direction | Approved API contract, access and identity/location mapping |
| Notifications and safety agent | Deferred | User need, trusted data, thresholds and controlled actions |

## Future RFID adapter contract

The eventual adapter should map a registered tag to an asset and a validated reader to a room, then supply observation time, receipt time and explicit source. Unknown tags/readers, duplicate packets, stale data, clock skew and simultaneous room detections require tested handling.

A reader detection alone must never check a battery in or out. Loss of detection must never assert that a battery is missing. Automatic placement and any freshness threshold must be calibrated against real evidence and agreed with the teacher.

## Next decision sequence

1. Stakeholder reviews the working teacher workflow.
2. Measure workload against the current method.
3. Obtain tag/reader models and one real output sample.
4. Validate room-level read performance in the actual storage environment.
5. Choose the smallest reliable adapter.
6. Seek institutional approval for hosting, identity and any JAGGAER integration.
