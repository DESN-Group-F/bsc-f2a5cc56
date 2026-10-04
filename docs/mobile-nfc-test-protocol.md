# NFC first physical test protocol

This protocol prepares the functional-test prototype **Test 0.1.0**. Its internal build identifier is `0.1.0`; it is excluded from formal releases and does not change the main application's version. No physical measurements or acceptance results are supplied in this document.

The initial target is the user's iPhone 13 and two stickers labelled NTAG213. Record the actual iOS version and package markings when testing; these are operator declarations. Android compatibility requires a separate Android trial.

For installation, signing and cloud preparation, use [Mobile NFC development and first physical test](mobile-nfc-development.md). The [validation record](mobile-nfc-validation.md) separates completed software checks from pending native/device checks.

## 1. Select the evidence track

| Track | What can be tested | How to label the evidence |
| --- | --- | --- |
| Preliminary reader utility | Whether the phone and stickers can be read by an independently installed NFC utility | Record the utility's name/version and its original output. This is utility evidence, not a Test 0.1.0 result. |
| Test 0.1.0 application | The signed prototype's native reads, local history, recovery and JSON export | Record the installed build and retain its original reports. A web preview is not a native-phone test. |
| Optional demonstration lookup | Whether a deliberately registered demonstration identifier resolves the intended battery record | Record the web lookup separately. A URL or matched record does not establish that a physical read occurred. |

An existing reader utility can be used while Apple identity review or cloud setup remains pending. Its success does not prove that our application compiles, installs or reads tags correctly. Do not copy its readings into the prototype as successful application attempts.

Before starting the application track, confirm that a signed Test 0.1.0 build is installed on the physical iPhone and that the app reports NFC available. Membership activation, native compilation, signing and any TestFlight processing are separate prerequisites. Do not record a browser preview or unsigned artifact as an installed phone application.

## 2. Prepare the baseline

1. Label the stickers **Test tag 01** and **Test tag 02** without covering or damaging them.
2. Place each on paper or plastic, away from metal and batteries. Keep the surface consistent throughout each tag's ten trials. Keep the unused sticker away from the phone so each attempt has one intended target.
3. Record the phone model, actual OS version, installed app/utility version, sticker package label, surface and phone-case condition in the session template below.
4. Leave the stickers' current content unchanged during this baseline. Do not write, format, lock or password-protect them to obtain a successful-looking result. Reading a UID does not require a URL on the sticker.
5. In Test 0.1.0, fill **Test setup** before reading. Use the correct tag label and surface for each group of trials. Leave **Trusted HTTPS website origin** blank for the baseline; backend access is unnecessary for the NFC radio test.
6. Keep the app in the foreground and the iPhone unlocked. Check that local report storage has no error. If storage is unavailable, retain the displayed error and stop application trials until the reports can be preserved.

If using a preliminary utility, read each sticker and save its UID, NDEF information and any errors in the separate utility table. Keep the original UID formatting. For a later comparison, remove only byte separators and normalize hexadecimal case; preserve every byte and leading zero. Do not reverse bytes or reinterpret a UID as a decimal number.

## 3. Run ten deliberate trials per sticker

Use the same procedure for Test tag 01, then Test tag 02. If the prototype is not installed yet, this procedure may be run in the utility track, but every row and conclusion must identify that utility.

1. Start one new reading session explicitly. In Test 0.1.0, tap **Start NFC read**.
2. Bring the iPhone's top edge close to the intended sticker and hold it still. Retain the actual success or error; the prototype's requested session timeout is 20 seconds.
3. Wait for the session to finish. Move the phone away before beginning the next deliberate attempt. Repeated callbacks during one session are not separate trials.
4. Record the attempt number, UID, NDEF result and actual outcome. Record elapsed time only if it was measured or retained by the app; do not estimate a missing value after the event.
5. Repeat until there are **ten attempts**, including failures, for that sticker. A retry is another attempt; it must not replace a failed row. Use a new run label if investigating a changed position, case or surface after the baseline.
6. Change **Test setup** to Test tag 02 and repeat the same ten-attempt procedure.

An initialized blank NDEF message with zero records is a valid result. Separate these cases:

- A valid UID with an empty NDEF message: UID and empty-message reads succeeded.
- A valid UID with an NDEF error: UID evidence exists, but NDEF reading requires investigation. Keep the error.
- NDEF reported as unsupported or unknown: retain that platform result; do not relabel it as a successfully read empty message or infer that the chip can never support NDEF.
- No UID, cancellation or an interrupted session: do not count it as a successful UID read.

## 4. Apply proposed baseline criteria

These are **proposed engineering trial criteria**, to be recorded before testing. They are not certified reliability requirements or measured claims.

| Check | Proposed pass criterion | What to do if it is not met |
| --- | --- | --- |
| UID acquisition | All ten baseline attempts for each sticker produce a complete UID: 20 of 20 total | Retain all rows. Investigate placement, phone case, tag or reader behavior and use a separately labelled follow-up run. |
| UID stability | The complete UID is identical across all successful baseline attempts for the same labelled sticker | Preserve the original output and compare with an independent reader. Do not overwrite conflicting bytes. |
| Sticker distinction | The two labelled stickers produce different complete UIDs | Check that only the intended sticker was near the antenna; preserve the discrepancy and stop identity binding until resolved. |
| NDEF evidence | Each attempt retains the actual NDEF status/content or error; an empty message is accepted as empty | Investigate errors/unsupported output separately from UID success. A UID pass alone does not establish NDEF compatibility. |
| Report completeness | All 20 baseline attempts remain recorded, with outcomes and setup labels | Resolve persistence or attribution gaps before declaring the application test complete. |

For the stated NTAG213 target, an unexpected UID format or length requires review of the raw reader output and package identification. The application's canonical identifier uses `nfc:uid:` followed by the normalized UID. That prefix does not authenticate a tag or identify a battery automatically.

Record separate conclusions for the utility track and the prototype track. Passing 20 trials on paper/plastic does not establish Android support, battery-mounted reliability, location tracking or a general read-success rate.

## 5. Check cancellation, timeout and recovery

Run these additional controls **after** the 20 baseline trials. Keep them as labelled control attempts; they do not replace baseline failures and do not belong in the baseline success fraction.

1. **Cancellation:** Start a read with no sticker near the antenna. On iPhone, use **Cancel** in the system NFC sheet; the sheet may cover the app's **Cancel this read** button. If no system sheet is displayed, use the app button. Retain the actual outcome; it must not create a successful UID reading. Then read Test tag 01 again and confirm that a new session can start.
2. **Timeout:** Start another read with both stickers away from the antenna and wait for the session to end. Record the actual error code/message and elapsed time if measured. It must not invent a UID. Then attempt another deliberate read to check that the reader is usable again.
3. **Completed-report persistence:** Close and reopen the app after a completed attempt. Confirm that the earlier baseline and control reports retain their identifiers, setup and outcomes.
4. **Interrupted-session recovery:** Start a read with no nearby sticker, then close the app while the attempt is pending. Reopen it. The original attempt must remain present with its actual failed/cancelled/interrupted classification and available evidence. Do not require an invented success or relabel an already received background error as a different outcome.
5. If a driver remains busy after cancellation or timeout, retain the error, note that recovery failed, and record any required app restart. A later successful read does not erase that recovery failure.

## 6. Export and inspect the evidence

1. Tap **Export all reports as JSON** and complete the phone's save/share action to a location you can reopen.
2. Verify that an actual file exists. Reopen it and check the internal build identifier, platform, setup labels, all 20 baseline attempts and every additional control attempt. Compare attempt IDs and counts with the app history.
3. Preserve the original JSON together with utility screenshots/output and the completed record below. Device timestamps are phone-clock evidence, not backend registration times.
4. Export before uninstalling, reinstalling or resetting local test storage. There is no automatic report backup or inventory synchronization in this prototype. If export is cancelled or fails, record that outcome; do not mark export verified.

## 7. Test the final mounting separately

After the paper/plastic baseline, start a new labelled run on the intended battery mounting surface. Record the sticker type, position, actual surface, phone case and any shielding/backing. Repeat the deliberate-trial and report-retention checks for that condition.

Keep final-mounting results separate from the baseline. Ordinary NFC stickers can behave differently near metal; a successful paper test does not approve a battery installation. If a different sticker, anti-metal construction or reader is introduced, repeat a focused physical test for that configuration. No room mapping, continuous observation or UHF tracking is validated by this protocol.

## 8. Optional demonstration backend check

This step is optional and comes only after the physical UID is stable and its canonical format has been reviewed. It is not part of the 20 NFC baseline trials.

1. Use a dedicated demonstration test environment. A responsible staff member must **explicitly register** a fictional test battery with the exact validated canonical identifier before the lookup. That registration is a deliberate fixture setup operation, not an automatic consequence of reading a sticker. Do not use or modify working-inventory business records for this protocol.
2. Confirm that the intended website includes the diagnostic `/nfc-test` page. The previously deployed site is not assumed to contain unpublished local changes. If no authorized HTTPS test endpoint exists, leave this step pending.
3. Configure only that trusted HTTPS origin in the prototype. The app does not follow arbitrary NDEF URLs. Tap **Open inventory lookup**, sign in with the website's own staff session, and explicitly choose **Look up identifier**.
4. Check that the known UID resolves the deliberately registered demonstration battery. Test an unregistered identifier and a signed-out session separately.
5. Confirm that lookup creates no battery, loan or location observation. A query match proves database identifier resolution only; the server does not verify that the UID was supplied by a real physical read.

## Blank session record

Leave results blank until testing. Use `Not measured`, `Not performed` or the actual error when applicable instead of inferring a result.

| Session field | Actual record |
| --- | --- |
| Run label | |
| Evidence track and reader name/version | |
| Installed prototype build, if used | |
| Phone model and actual OS version | |
| Test date/time and timezone | |
| Operator | |
| Sticker package label / supplier reference | |
| Surface and position | |
| Phone-case condition | |
| Export filename and verified location | |

### Preliminary utility evidence

| Sticker | Utility name/version | Original UID output | NDEF result or error | Evidence filename | Actual notes |
| --- | --- | --- | --- | --- | --- |
| Test tag 01 | | | | | |
| Test tag 02 | | | | | |

### Baseline attempt record

| Sticker | Attempt | Actual outcome | Complete UID | NDEF status / records / error | Time if measured | Report ID / evidence |
| --- | ---: | --- | --- | --- | --- | --- |
| Test tag 01 | 1 | | | | | |
| Test tag 01 | 2 | | | | | |
| Test tag 01 | 3 | | | | | |
| Test tag 01 | 4 | | | | | |
| Test tag 01 | 5 | | | | | |
| Test tag 01 | 6 | | | | | |
| Test tag 01 | 7 | | | | | |
| Test tag 01 | 8 | | | | | |
| Test tag 01 | 9 | | | | | |
| Test tag 01 | 10 | | | | | |
| Test tag 02 | 1 | | | | | |
| Test tag 02 | 2 | | | | | |
| Test tag 02 | 3 | | | | | |
| Test tag 02 | 4 | | | | | |
| Test tag 02 | 5 | | | | | |
| Test tag 02 | 6 | | | | | |
| Test tag 02 | 7 | | | | | |
| Test tag 02 | 8 | | | | | |
| Test tag 02 | 9 | | | | | |
| Test tag 02 | 10 | | | | | |

### Additional controls and optional lookup

| Check | Actual outcome / code | Evidence / report ID | Follow-up needed |
| --- | --- | --- | --- |
| Cancel a pending read | | | |
| Read again after cancellation | | | |
| Timeout with no nearby tag | | | |
| Read again after timeout | | | |
| Completed reports survive reopen | | | |
| Pending attempt survives interrupted session | | | |
| JSON file saved and reopened | | | |
| Optional known demonstration UID lookup | | | |
| Optional unknown identifier lookup | | | |
| Optional signed-out lookup | | | |
| Optional lookup leaves business state unchanged | | | |

### Actual conclusion

| Question | Recorded result |
| --- | --- |
| Evidence track assessed | |
| UID successes / baseline attempts for tag 01 | |
| UID successes / baseline attempts for tag 02 | |
| UID stable for each sticker | |
| Sticker UIDs distinct | |
| NDEF findings and unresolved errors | |
| Cancellation, timeout and recovery findings | |
| Export verified | |
| Proposed criteria met / not met / incomplete | |
| Final mounting separately tested | |
| Remaining uncertainty and next experiment | |

Do not replace the blank conclusion with the expected outcome. Retain failed attempts and unresolved differences alongside successful readings.
