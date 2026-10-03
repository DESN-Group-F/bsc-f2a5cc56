# Battery model registration workflow

This local follow-up adds reusable specification suggestions to **Register battery**. Returning an already registered battery still uses **Scan return**. A model template is not a physical battery and creates no stock, loan or location observation.

For several new batteries with the same common details, open **Intake & removal → New battery intake** and use [batch intake](batch-intake.md). Review common model assistance once, then stage deliberate demonstration scans in an editable queue. Confirm all or selected drafts to create independently numbered batteries with separate server registration times. Unconfirmed drafts are not inventory records. The real RFID intake workflow remains unavailable.

## Register a new physical battery

1. Open **Register battery**. Search **Find a model** by brand, model or variant. **Clear filters** clears the option search while preserving form values and selected records.
2. Review the exact model and configuration, source category, capacity qualification and any warnings. Research references are product information; they do not establish that a school owns a particular battery or that its condition is safe.
3. Choose **Use this model** after checking the physical label. Known suggestions fill empty fields. Different values already entered stay unchanged unless their replacement checkboxes are selected. Unknown suggestions leave the existing field alone.
4. Enter the individual battery ID, responsible staff owner, J18 storage and optional room. Record its RFID identifier and dates only when known. These fields are never copied from a model.
5. Review and register the battery. **Use manual details** permits unknown, self-built or unmatched batteries without a catalog selection; it retains the entered form values.

## Add or correct a reusable model

All active staff can choose **Add reusable model**. Enter the brand if known, exact model, distinguishing variant, suggested name and known specifications. Unknown numeric specifications remain blank. Save the template, then review and apply it to the physical battery form. Saved templates are shared by staff in the same inventory; demonstration templates remain separate from working templates.

Administrators can select a saved template and choose **Edit model**. Changes are versioned and recorded with their operator. They change later suggestions, not existing registered assets or earlier evidence. Research references and suggestions derived from existing assets are not edited through this template form.

If saving is interrupted, retry the preserved request. The same identifier and payload recover its receipt rather than creating another model. After an authentication failure, sign in again before retrying that original request. Do not interpret a timeout as proof that nothing was saved.

## Evidence and limits

Candidates come from the existing published research catalog, staff-entered templates and registered batteries whose model specifications agree. Conflicting registered specifications are reported and excluded from automatic suggestions. Model labels are candidate matches; the software does not infer an exact product from appearance, similar values or RFID.

Research mapping uses only supported rated, nominal or test-rated capacity, preserving its qualification. Minimum, typical and unqualified stated capacities remain reference information. Capacity labels are neutral because a source can qualify the value differently. Unknown dates, age, capacity and voltage are not estimated.

The server validates the reviewed model hash and rebuilds its evidence. Registered source records and saved-template versions are checked again at the atomic registration boundary. The registration audit retains the selected model, original evidence, applied fields and individual overrides. Complete operation-history downloads include that evidence; selecting specifications alone downloads the individual asset fields.

This phase does not expand the research dataset, import real school stock, change CSV model matching, enable RFID hardware, create automatic safety decisions or train a model. CSV registration continues to accept reviewed asset records without guessing catalog relationships.
