# Battery model reference catalog

## Purpose and delivery status

This catalog reduces repeated product research during registration. It answers which commercial product a battery is. The existing `batteries` table remains the single register of physical assets. A catalog record has no school stock quantity, owner, RFID tag, purchase claim or loan state.

Release `2026.10.03.4` contains 202 independent product models and 202 variant records across 7 chemistries, with 253 source records representing 244 distinct opened URLs and 3573 field-evidence rows. 200 independent models are `verified_core`; 2 remain `partial`. Source consultation dates are retained per source. This is public product research, not school inventory or a procurement list; actual school coverage remains unknown. This release changes data only and implements no application functionality.

Completed artifacts are in `data/battery-catalog/`:

The application source snapshot includes the current JSON catalog, schema, validation report, research inputs and assembly/query tools. Generated SQLite files, historical release archives and rendered research workbooks remain local deliverables and are excluded from the source repository. The commands below rebuild the reference SQLite database from the included catalog; the application itself reads the pinned JSON directly.

| File | Role |
| --- | --- |
| `catalog.json` | Canonical machine-readable catalog with specifications, provenance, conflicts and unknowns |
| `catalog.schema.json` | JSON Schema for the data contract |
| `catalog.sqlite3` | Populated, isolated local reference database; not an application or D1 database |
| `sqlite-schema.sql` | Reference database tables, indexes and candidate prefill view |
| `assemble_catalog.py` | Reproducible assembly of 21 explicitly named research fragments |
| `catalog_tool.py` | Standard-library-only validation, database build and read-only queries |
| `validation-report.json` | Actual validation results and runtime versions |
| `catalog-plan.json` | User-approved target, mutually exclusive category allocation and independent review policy |
| `catalog-classification.json` | Editorial primary category for each record, tied to the current content hash |
| `catalog-review-log.json` | Per-release independent samples and actual research audit links |
| `update_catalog_document.py` | Refreshes current counts from a passing report while preserving historical prose |
| `archive_catalog_release.py` | Freezes validated data, scripts, inputs and reviews without rewriting prior archives |
| `research/*.json` | 21 reviewed input fragments plus clearly named independent audit records; audits are not assembly inputs |
| `releases/2026.10.02.1/` | Preserved first-release artifacts and document with raw-file SHA-256 manifest |

No application integration, application schema change, migration, runtime database edit, deployment, maintenance activation or commit was performed for this delivery. All writes were confined to the catalog directory and this document.

## Completed research plan: 200 verified independent products

**Status: user-approved work plan; completed.** The starting published baseline was release `2026.10.02.2`: 44 independent products, 44 records, 42 `verified_core`, two `partial`. The cumulative target is **200 core-verified independent products**, including this baseline. Pending identities remain separate and do not count toward the target. The earlier proposal of 100-150 products with approximately 120 as a workload reference, and the instruction to stop around 60, are superseded by this user decision; they are not active targets. The checkpoints are approximately 60, 100, 150 and 200 cumulative verified products. Checkpoints require review, versioned artifacts and progress reporting, then research continues without another approval request.

| Mutually exclusive primary research category | Planned cumulative verified products | Baseline verified products |
| --- | ---: | ---: |
| Tool-platform dedicated battery packs | 40 | 0 |
| Single-cell small pouches / electronics prototype batteries | 40 | 0 |
| Other general finished LiPo / Li-ion battery packs | 55 | 13 |
| Standalone cylindrical / prismatic Li-ion or LiFePO4 cells, excluding prototype pouches | 40 | 15 |
| NiMH, standard-size primary cells, small sealed lead-acid and supplementary types | 25 | 14 |
| Total | 200 | 42 |

Assign one primary category using the table's priority order: dedicated tool battery, prototype pouch, other finished lithium pack, standalone lithium cell, supplementary type. A product is counted once even if it serves several uses. These categories organize public reference research; they do not establish UNSW use, procurement preferences or charger/tool compatibility. Category allocations may be adjusted autonomously when reliable evidence and distinct added value justify the change; record the reason and both allocations while retaining the total target of 200. Do not fill a quota with ambiguous or duplicate products. Priority is gaps in categories, brands and platforms, rather than more near-identical Molicel/Tattu/eneloop products.

For every product retain verified brand and exact model, chemistry, nominal voltage, capacity with its original rated/nominal/minimum/typical/stated qualification, and an editable brand/model name suggestion. A capacity scalar may be null when an opened source establishes why no appropriate scalar was selected. Do not substitute charge limits or marketing platform voltage for nominal voltage. Prefer actually opened manufacturer pages, datasheets and manuals; clearly distinguish any brand-owner or distributor evidence. Every selected fact requires its source URL, consultation date, revision when stated, exact applicability and field locator. Major identity/version/applicability conflicts remain pending and are excluded from the 200 verified count. Aliases, retail multipacks, seller duplicates and regional copies do not add independent products; genuine variant records are reported separately.

The researcher compares every new model field against its actual source before merging. Each batch then receives an independent source sample covering **at least 20% of newly verified products**, rounded up, across its categories, brands and source forms. Recheck all major conflicts and potentially misleading interpretations. An error expands review of the same source or extraction method. Record actual objects, findings and limitations; automatic citation-integrity validation is not scientific accuracy verification.

At each checkpoint update canonical JSON, reproducible SQLite, classification data, validation report and this document. Check independent identity, unique classification, units/nulls, capacity qualifications, source references, read-only queries, JSON/SQLite equality and historical artifact preservation. Report new/cumulative verified products, records/extra variants, category/brand distribution, five-field coverage, absent scalar capacities, pending identities, source counts, actual independent sampling and automatic checks. This work is data only: it adds no registration assistant, application/API/page change, business-database migration or write, deployment, school inventory or building/room record. Actual procurement coverage and sufficiency remain unknown until real school model/label samples are available; reaching 200 is not a coverage guarantee or UNSW standard.

### UNSW context and research priorities

The official [hand-held drill table](https://www.making.unsw.edu.au/our-machines/drill/) and [powered hand-tool saw table](https://www.making.unsw.edu.au/our-machines/powered-hand-tools-saws/) list Makita equipment in the James N. Kirby Makerspace. These are tool models, not battery models, and support researching Makita battery platforms first. They do not identify purchased batteries or prove that a particular reference pack is present or compatible. The [Elec Makerspace description](https://www.making.unsw.edu.au/engineering-makerspace/facilities/digfab-lab/) supports electronics prototyping as a research context; the [Engineering Makerspaces overview](https://www.making.unsw.edu.au/engineering-makerspace/about/) describes Renewables student rocket and drone projects and locates James N. Kirby at J18. The current application remains the J18 pilot. The four pages were actually opened on 2026-10-02 and are preserved as planning evidence in `research/batch3-scope-evidence.json`, outside canonical product source counts. No school purchasing list was supplied.

## Model coverage

<!-- current-catalog-status:start -->
### Current checkpoint

Current release `2026.10.03.4`: 200/200 verified independent products; 202 records; 0 extra variants. The latest batch adds 50 verified products. Work status: user_approved_completed.

| Primary research category | Independent products | Verified | Target |
| --- | ---: | ---: | ---: |
| tool_platform | 40 | 40 | 40 |
| prototype_pouch_1s | 40 | 40 | 40 |
| general_finished_lithium_pack | 56 | 55 | 55 |
| standalone_lithium_cell | 41 | 40 | 40 |
| supplementary | 25 | 25 | 25 |

Five-field coverage (independent products): brand_and_exact_model: 202/202; chemistry: 202/202; nominal_voltage: 202/202; capacity_scalar_with_original_kind: 193/202; editable_name_suggestion: 202/202.

Capacity observations by original kind: rated: 26; nominal: 64; minimum: 67; typical: 66; stated: 54. Kinds overlap. Missing all scalar capacity: duracell-mn1300-us-flat-cell, duracell-mn1400-us-flat-cell, duracell-mn1500-us-flat-cell, duracell-mn2400-us-flat-cell, duracell-mx2500-us-flat-cell, energizer-e91-standard-flat-contact, energizer-e92-standard-flat-contact, energizer-l91-standard-cell, energizer-l92-standard-cell. Pending: eve-lf105-terminal-unspecified, tattu-taa15504s15x6-rline5-xt60.

Brands (record counts): Adafruit: 1; DEWALT: 15; Duracell: 5; EEMB: 20; EVE: 1; Energizer: 4; Gens ace: 1; Hacker: 12; Inspired Energy: 4; Jauch: 19; Lithium Werks: 3; Makita: 8; Milwaukee: 17; Molicel: 12; Murata: 11; Panasonic: 14; Power-Sonic: 6; RRC: 11; SparkFun: 3; Tattu: 13; Tenergy: 12; Yuasa: 2; eneloop: 8.

Independent source review for the latest batch: 15/50 newly verified products (minimum 10). Actual audit files and source-access limitations are recorded in `catalog-review-log.json` and its linked research audits. Automated validation does not re-fetch sources.

| Release | Verified independent products | Records | Sources |
| --- | ---: | ---: | ---: |
| 2026.10.02.1 | 11 | 12 | 22 |
| 2026.10.02.2 | 42 | 44 | 61 |
| 2026.10.03.1 | 60 | 62 | 88 |
| 2026.10.03.2 | 100 | 102 | 116 |
| 2026.10.03.3 | 150 | 152 | 184 |
| 2026.10.03.4 | 200 | 202 | 253 |

<!-- current-catalog-status:end -->

### Archived second-batch expansion and five-field coverage

Release `2026.10.02.2` adds 32 independent products: 10 Molicel Li-ion cells, 4 LiFePO4 cells, 12 Tattu LiPo packs and 6 eneloop NiMH cells. Of these, 31 are `verified_core`; 25 verified additions are rechargeable lithium products (80.6% of verified additions, exceeding two thirds). EVE LF105 is the one new `partial` reference and is excluded from the verified target. All 32 new references have the five requested fields, including the original capacity qualification; numerical completeness does not resolve LF105's hardware variant.

| Counting scope | Independent products | Variant records | Extra variant records | Verified independent products |
| --- | ---: | ---: | ---: | ---: |
| Preserved first batch | 12 | 12 | 0 | 11 |
| Second batch | 32 | 32 | 0 | 31 |
| Archived release 2026.10.02.2 | 44 | 44 | 0 | 42 |

Independent products are counted by normalized brand and exact base model. Manufacturer part-number aliases, regional pages, retail `/2`, `/4` and `/4H` quantities, and connector-only variants do not create additional products. The 12 added packs also have 12 distinct combinations of capacity, nominal voltage and explicit S/P configuration, so their count is not inflated by connector alternatives.

| Priority field | First batch / 12 | Second batch / 32 | Archived release / 44 |
| --- | ---: | ---: | ---: |
| Brand and exact model | 12 | 32 | 44 |
| Chemistry | 12 | 32 | 44 |
| Nominal voltage | 12 | 32 | 44 |
| Capacity scalar with original qualification | 8 | 32 | 40 |
| Editable suggested display name | 12 | 32 | 44 |

Archived release `2026.10.02.2` has 2 rated, 13 nominal, 23 minimum, 15 typical and 1 unqualified stated capacity observations at record level. These categories overlap: a model may have both minimum and typical capacity. Twenty-nine `rated_capacity_mah` fields are null, but only four models lack every scalar capacity: Energizer E91, E92, L91 and L92. Their discharge graphs are not reduced to a guessed value. Suggested names use `{brand} {model}` and remain editable; neither the name nor a complete five-field row confirms a received physical asset.

### New product references

Capacity values below are mAh. Every row links to its actual model-specific manufacturer page or datasheet; the complete source record, access date, exact field locators and any supporting family source remain in the JSON. Optional fields outside the five priorities were not exhaustively researched.

| Brand / exact model and primary source | Chemistry | Kind | Nominal V | Capacity mAh and original kind | Status |
| --- | --- | --- | ---: | --- | --- |
| [EVE LF105](https://www.evemall.eu/power-battery/prismatic-lfp-cell/lf105) | LiFePO4 | cell | 3.2 | 105000 nominal | partial |
| [Lithium Werks AER18650m2A2](https://lithiumwerks.com/products/lithium-ion-lfp-18650-energy-cell/) | LiFePO4 | cell | 3.2 | 1700 minimum; 1800 typical | verified_core |
| [Lithium Werks ANR26650M1B](https://lithiumwerks.com/wp-content/uploads/2022/08/26650-Power-Cell-080322.pdf) | LiFePO4 | cell | 3.3 | 2500 minimum; 2600 typical | verified_core |
| [Lithium Werks APR18650m1B](https://lithiumwerks.com/products/lithium-ion-18650-cells/) | LiFePO4 | cell | 3.3 | 1150 minimum; 1200 typical | verified_core |
| [Molicel INR-18650-P22S](https://www.molicel.com/wp-content/uploads/INR18650P22S_1.0_Product-Data-Sheet-of-INR-18650-P22S-80137.pdf) | Li-ion | cell | 3.6 | 2000 minimum; 2200 typical | verified_core |
| [Molicel INR-18650-P26A](https://www.molicel.com/wp-content/uploads/INR18650P26A_1.4_Product-Data-Sheet-of-INR-18650-P26A-80087.pdf) | Li-ion | cell | 3.6 | 2600 typical | verified_core |
| [Molicel INR-18650-P28B](https://www.molicel.com/wp-content/uploads/INR18650P28B-V1-80104.pdf) | Li-ion | cell | 3.6 | 2650 minimum; 2800 typical | verified_core |
| [Molicel INR-18650-P30B](https://www.molicel.com/wp-content/uploads/Product-Data-Sheet-of-INR-18650-P30B-80111-1.pdf) | Li-ion | cell | 3.6 | 2900 minimum; 3000 typical | verified_core |
| [Molicel INR-18650-P30S](https://www.molicel.com/wp-content/uploads/Product-Data-Sheet-of-INR-21700-P30S-1.1.pdf) | Li-ion | cell | 3.6 | 2900 minimum; 3000 typical | verified_core |
| [Molicel INR-21700-M65A](https://www.molicel.com/wp-content/uploads/Product-Data-Sheet-of-INR-21700-M65A-80153-0.1_250805.pdf) | Li-ion | cell | 3.6 | 6400 minimum; 6500 typical | verified_core |
| [Molicel INR-21700-P42B](https://www.molicel.com/wp-content/uploads/INR21700P42B-V1-80101.pdf) | Li-ion | cell | 3.6 | 4000 minimum; 4200 typical | verified_core |
| [Molicel INR-21700-P45B](https://www.molicel.com/wp-content/uploads/INR21700P45B_1.2_Product-Data-Sheet-of-INR-21700-P45B-80109.pdf) | Li-ion | cell | 3.6 | 4300 minimum; 4500 typical | verified_core |
| [Molicel INR-21700-P50B](https://www.molicel.com/wp-content/uploads/Product-Data-Sheet-of-INR-21700-P50B-80122.pdf) | Li-ion | cell | 3.6 | 4850 minimum; 5000 typical | verified_core |
| [Molicel INR-21700-P50S](https://www.molicel.com/wp-content/uploads/Product-Data-Sheet-of-INR-21700-P50S-80XXX-1.1-1.pdf) | Li-ion | cell | 3.6 | 4900 minimum; 5000 typical | verified_core |
| [eneloop BK-3HCC](https://panasonic.jp/battery/products/BK-3HCC_4/spec.html) | NiMH | cell | 1.2 | 2450 minimum | verified_core |
| [eneloop BK-3LCC](https://panasonic.jp/battery/products/BK-3LCC_2/spec.html) | NiMH | cell | 1.2 | 950 minimum | verified_core |
| [eneloop BK-3MCD](https://panasonic.jp/battery/products/BK-3MCD_4H/spec.html) | NiMH | cell | 1.2 | 2000 minimum | verified_core |
| [eneloop BK-4HCC](https://panasonic.jp/battery/products/BK-4HCC_4/spec.html) | NiMH | cell | 1.2 | 900 minimum | verified_core |
| [eneloop BK-4LCC](https://panasonic.jp/battery/products/BK-4LCC_2/spec.html) | NiMH | cell | 1.2 | 550 minimum | verified_core |
| [eneloop BK-4MCD](https://panasonic.jp/battery/products/BK-4MCD_4H/spec.html) | NiMH | cell | 1.2 | 800 minimum | verified_core |
| [Tattu TAA10503S75X6](https://www.tattuworld.com/products/tattu-classic-1050mah-3s1p-11-1v-75c-fpv-lipo-battery.html) | LiPo | pack | 11.1 | 1050 nominal | verified_core |
| [Tattu TAA12006S15X6](https://www.tattuworld.com/products/tattu-r-line-5-0-1200mah-6s1p-22-2v-150c-fpv-lipo-battery.html) | LiPo | pack | 22.2 | 1200 nominal | verified_core |
| [Tattu TAA13004S15X6](https://www.tattuworld.com/products/tattu-r-line-5-0-1300mah-4s1p-14-8v-150c-fpv-lipo-battery.html) | LiPo | pack | 14.8 | 1300 nominal | verified_core |
| [Tattu TAA13006S16ST](https://www.tattuworld.com/products/tattu-r-line-6-0-1300mah-6s1p-22-2v-160c-st-fpv-lipo-battery.html) | LiPo | pack | 22.2 | 1300 nominal | verified_core |
| [Tattu TAA14806S16ST](https://www.tattuworld.com/products/tattu-r-line-6-0-1480mah-6s1p-22-2v-160c-st-fpv-lipo-battery.html) | LiPo | pack | 22.2 | 1480 nominal | verified_core |
| [Tattu TAA16006S16ST](https://www.tattuworld.com/products/tattu-r-line-6-0-1600mah-6s1p-22-2v-160c-st-fpv-lipo-battery.html) | LiPo | pack | 22.2 | 1600 nominal | verified_core |
| [Tattu TAA18006S15X6](https://www.tattuworld.com/products/tattu-r-line-5-0-1800mah-6s1p-22-2v-150c-fpv-lipo-battery.html) | LiPo | pack | 22.2 | 1800 nominal | verified_core |
| [Tattu TAA20004S15X6](https://www.tattuworld.com/products/tattu-r-line-5-0-2000mah-4s1p-14-8v-150c-fpv-lipo-battery.html) | LiPo | pack | 14.8 | 2000 nominal | verified_core |
| [Tattu TAA22005S15X6](https://www.tattuworld.com/products/tattu-r-line-5-0-2200mah-5s1p-18-5v-150c-fpv-lipo-battery.html) | LiPo | pack | 18.5 | 2200 nominal | verified_core |
| [Tattu TAA3002S75JST](https://www.tattuworld.com/products/tattu-classic-300mah-2s1p-7-6v-hv-75c-fpv-lipo-battery.html) | LiPo | pack | 7.6 | 300 nominal | verified_core |
| [Tattu TAA8503S15X3](https://www.tattuworld.com/products/tattu-r-line-5-0-850mah-3s1p-11-1v-150c-fpv-lipo-battery.html) | LiPo | pack | 11.1 | 850 nominal | verified_core |
| [Tattu TAA8504S95XT3L](https://www.tattuworld.com/products/tattu-classic-850mah-4s1p-15-2v-hv-95c-fpv-lipo-battery.html) | LiPo | pack | 15.2 | 850 nominal | verified_core |

The Lithium Werks part numbers 300832-001, 300949-001 and 320749-001 are aliases of the corresponding named cells, not additional models. LF105's 105 Ah is converted to 105000 mAh, retaining `nominal`; its terminal version remains unspecified. Tattu HV pack nominal voltages are copied as 7.6 V and 15.2 V rather than derived from conventional LiPo per-cell voltage. The Molicel P30S URL contains `21700`, but both PDF model headings and its separate exact product page identify INR-18650-P30S; the filename is not used as identity evidence. P50S/P30S literal capacity-row qualifications are preserved without inventing a complete test protocol. No claim is made that the accessed sheets are the newest revisions.

### Preserved first-batch references

The 12 original model objects and all 22 original source objects are preserved exactly. The following original table is retained for comparison.

The table below summarizes source-backed values. `null` means no usable value under that field's exact definition. Separate capacity columns deliberately preserve manufacturer qualifications.

| Brand / exact model | Kind / form | Chemistry | Nominal V | Rated mAh | Minimum mAh | Typical mAh | Stated mAh | Status |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Energizer E91 | cell / AA flat contact | Alkaline Zn/MnO2 | 1.5 | null | null | null | null | verified_core |
| Energizer E92 | cell / AAA flat contact | Alkaline Zn/MnO2 | 1.5 | null | null | null | null | verified_core |
| Energizer L91 | cell / AA | Li/FeS2 | 1.5 | null | null | null | null | verified_core |
| Energizer L92 | cell / AAA | Li/FeS2 | 1.5 | null | null | null | null | verified_core |
| Molicel INR-18650-P28A | cell / 18650 | Li-ion | 3.6 | null | 2700 | 2800 | null | verified_core |
| Molicel INR-21700-P42A | cell / 21700 | Li-ion | 3.6 | null | 4000 | 4200 | null | verified_core |
| eneloop BK-3MCC | cell / AA | NiMH | 1.2 | null | 1900 | null | null | verified_core |
| eneloop BK-4MCC | cell / AAA | NiMH | 1.2 | null | 750 | null | null | verified_core |
| Yuasa NP7-12, standard case, 4.75 mm Faston | pack / rectangular block | Lead-acid AGM VRLA | 12 | 7000 | null | null | null | verified_core |
| Yuasa NP12-12, standard case, 6.35 mm Faston | pack / rectangular block | Lead-acid AGM VRLA | 12 | 12000 | null | null | null | verified_core |
| Tattu TAA15504S15X6, R-Line 5.0, XT60 | pack / rectangular | LiPo | 14.8 | null
| 1550 | null | null | partial |
| Gens ace GEA223S30X6GT, G-Tech Soaring, XT60 | pack / rectangular | LiPo | 11.1 | null | null | null | 2200 | verified_core |

Primary evidence includes [Energizer E91](https://data.energizer.com/pdfs/e91_max_na.pdf), [E92](https://data.energizer.com/pdfs/e92.pdf), [L91](https://data.energizer.com/pdfs/l91.pdf), [L92 edition L92GL0725](https://data.energizer.com/pdfs/L92GL0725.pdf), [Molicel P28A](https://www.molicel.com/wp-content/uploads/INR18650P28A-V2-80093.pdf), [Molicel P42A](https://www.molicel.com/product/inr-21700-p42a/), [Panasonic BK-3MCC manual](https://panasonic.jp/manualdl/p-db/p_/p_bk3mcc248_t_201304181131_0.pdf), [BK-4MCC manual](https://panasonic.jp/manualdl/p-db/p_/p_bk4mcc24_t_201304181134_0.pdf), [Yuasa NP7-12](https://www.yuasa.com/uk/np7-12), [NP12-12](https://www.yuasa.com/uk/np12-12), [Tattu exact SKU](https://gensace.de/products/taa15504s15x6), and [Gens ace exact G-Tech SKU](https://gensace.de/products/gens-ace-g-tech-soaring-2200mah-11-1v-30c-3s1p-lipo-battery-pack-with-xt60-plug). Full titles, editions, applicability and field locators are in the JSON.

Yuasa values are explicit 20-hour discharge ratings at 20 degrees Celsius to 1.75 V per cell, converted from 7 Ah and 12 Ah using 1000 mAh/Ah. Molicel and eneloop minimum/typical values are not silently relabelled rated. Gens ace's unqualified `Capacity` is stored separately. Energizer capacity curves depend on discharge conditions and are not digitized into a single scalar. Charge limits and floating-charge voltages are never substituted for nominal voltage. The original twelve `energy_wh` values remain null. The second batch copies explicit manufacturer nominal energy for three Lithium Werks cells (8.58, 3.96 and 5.76 Wh); no value is calculated from V times Ah. Other optional energy values remain uncurated even where a page provides an energy number.

## Field dictionary

All JSON fields are explicitly present. Optional unknown facts are `null`, not zero, empty strings, estimated values or invented defaults. Absence-evidence entries may document why a field is null. Empty arrays mean no recorded entries of that type. A nullable object may contain null dimensions, configuration components or connector polarity.

### Product identity and stable specifications

| Catalog field | Definition / unit | Existing application support |
| --- | --- | --- |
| `catalog_id` | Permanent identifier for a curated product variant; never a physical asset ID | Future catalog identity and asset linkage |
| `manufacturer` | Named manufacturer organization when established; not an inferred factory or manufacturing country | Future separate field; 158 legal-manufacturer values remain null |
| `brand` | Verified product brand; distinct from manufacturer | Future separate field; searchable via existing model text after mapping |
| `model` | Exact manufacturer model, MPN or brand-store SKU | Existing `model` text, maximum 120 characters |
| `variant_key`, `variant_description` | Stable distinguishing key and source-backed/editorial description of selected case, connector, product series or exact cell | Future structured fields; physical confirmation still required |
| `aliases[].value` | Manufacturer identifier or search phrase; alias type and matching policy are preserved | Future search metadata |
| `aliases[].kind` | `mpn`, `manufacturer_alias` or `search_term` | Future |
| `aliases[].match_policy` | `exact_candidate` returns candidates only; `search_only` cannot establish exact identity | Future |
| `suggested_display_name` | Editable suggestion using `{brand} {model}`; no asset identity or purchasing assertion | Existing `name`, maximum 120 characters; not a compulsory naming rule |
| `chemistry` | Controlled chemical-system code; independent of shape and pack configuration | Existing free-text `chemistry`; labels mapped below |
| `rechargeable` | Manufacturer-supported boolean or null | Future separate field; not a charging authorization |
| `unit_kind` | `cell` is one electrochemical cell; `pack` is an assembled battery/block | Future separate field |
| `form_factor.code`, `.description` | Size/shape designation and editorial description; AA/18650/rectangular do not identify chemistry or model | Future separate field |
| `rated_capacity_mah` | Explicit rated/nominal or defined discharge-rate capacity, in mAh | Existing nullable `capacityMah` / DB `capacity_mah` |
| `capacity_basis` | Qualification of `rated_capacity_mah`: `rated`, `nominal` or `not_stated`; `not_stated` requires the rated field to be null | Future persisted basis; current scalar lacks this information |
| `minimum_capacity_mah`, `typical_capacity_mah` | Separately labelled manufacturer values in mAh; never silently copied into a rated field | Future separate fields / source-review display |
| `stated_capacity_mah`, `stated_capacity_label` | An explicit number with its original source label; also retains qualified thresholds such as >= that overlap a separately typed nominal/rated observation. A generic capacity label does not establish rated/minimum/typical basis | Future separate fields / source-review display |
| `capacity_test_conditions` | Source-stated conditions, or standard reference without inventing the standard's detailed test settings; applies to the cited capacity evidence | Future metadata |
| `nominal_voltage_v` | Nominal operating voltage in V | Existing nullable `voltage` / DB `voltage` |
| `energy_wh`, `energy_basis` | Explicit manufacturer nominal/rated energy in Wh and qualification; not a computed estimate | Future separate fields |
| `configuration.series`, `.parallel` | Explicit cell configuration; each positive integer or null. A block's configuration is not inferred from voltage | Future separate fields |
| `connector.description`, `.polarity` | Exact terminal/connector variant; polarity remains null when not verified | Future separate fields |
| `dimensions_mm` | Diameter/length/width/height in mm, plus `basis` retaining maxima, tolerances or approximation; source axis names are preserved | Future separate fields |
| `mass_g` | Source value in g, with typical/maximum/approximate qualification retained in its field evidence | Future field; not an asset measurement |
| `maintenance_notes` | Short source summary or null; no inferred recurrence interval | Future reference display only |

The chemistry vocabulary maps to current English display values as follows:

| Catalog code | Application text suggestion |
| --- | --- |
| `alkaline_zinc_manganese_dioxide` | `Alkaline` |
| `lithium_iron_disulfide` | `Li-FeS2` |
| `nickel_metal_hydride` | `NiMH` |
| `lithium_ion` | `Li-ion` |
| `lithium_ion_polymer` | `LiPo` |
| `lead_acid` | `Lead-acid` |
| `lithium_iron_phosphate` | `LiFePO4` |

LiPo is the source's product category, not a claim about an unverified cathode composition. AGM/VRLA is a lead-acid construction description. `3S`, `AA` and `18650` belong to configuration/shape/search metadata rather than chemistry.

### Evidence and release metadata

| Field | Definition |
| --- | --- |
| `source_ids` | Sources attached to this exact curated product record |
| `field_evidence` | JSON Pointer -> observations with `source_id`, `locator` and short factual paraphrase; parents may combine the same leaf observations |
| `verification_status` | `verified_core`: identity, chemical class, cell/pack classification, rechargeability and nominal voltage have evidence; this does not assert all optional fields are known. `partial`: a core identity/applicability conflict requires additional confirmation |
| `conflicts` | Explicit disagreements or contradictory source wording, including excluded values and reasons |
| `unknowns` | Reasons selected optional facts are not confidently established |
| `notes` | Curatorial interpretation and exact applicability boundaries; not manufacturer quotations |
| `sources[].source_id` | Unique stable source identifier |
| `sources[].url`, `.title`, `.publisher` | Actual opened source URL, document title and source publisher; translated descriptive titles are identified as such |
| `sources[].source_type` | Manufacturer page, datasheet, manual, or clearly labelled secondary distributor; no secondary distributor is used in this seed |
| `sources[].document_version` | Printed edition/revision when present. Generated-sheet dates are labelled as dates, not technical revisions; unstated revisions are null |
| `sources[].accessed_on` | Actual research consultation date; independent of document publication date |
| `sources[].applicable_variants` | Exact products or deliberately limited family-level facts supported by this source |
| `sources[].access_status`, `.locator_notes` | `opened` records successful research access and relevant sections/access limitations; not a promise of continuous availability |
| `schema_version` | Data-contract version, currently `1.1.0` |
| `catalog_version` | Curated release version, currently `2026.10.03.4` |
| `published_on` | Catalog release date, not a manufacture or source publication date |
| `scope` | Explicit public-product-reference scope |
| `units` | mAh, V, Wh, mm and g contract; unit changes are rejected |
| `display_name_template` | Advisory naming template; not a factual specification |

Every populated key specification has a source locator. Programmatic validation checks evidence presence and reference integrity; it cannot independently prove that an observation correctly interprets its source. No complete third-party datasheets or manuals are redistributed here; links and factual summaries preserve source identity.

## Known conflicts and limits

15 records contain conflict notes; this does not mean 15 models are pending. The six original conflict records remain unchanged. P28A weight is qualified differently by the sheet and webpage, so its mass is null. P42A maximum dimensions differ between sources, so its dimensions are null. Two eneloop records retain a contradiction between generic PSDS handling text and model-specific recharge instructions; the model manuals support rechargeability and no generic sentence becomes a maintenance rule. L92 has edition-dependent resistance information and conflicting minimum dimension drawings; resistance is omitted and only common maximum external dimensions are recorded. The original Tattu TAA15504S15X6 listing mixes V5.0 and V4 marketing text, so it remains `partial` and requires label/version review. Four newly added HCC/LCC eneloop records retain the same generic PSDS contradiction, while exact model sources support rechargeability. EVE LF105's own product introduction advertises multiple threaded-hole versions but does not identify a selected version in the reviewed HTML text. LF105 is therefore `partial`, with an unspecified terminal variant and null connector. Its linked feature-image pixels were not examined; image-only specifications remain unverified. These two partial records are excluded from verified counts.

<!-- later-source-limits:start -->
Tenergy 31003 has conflicting 3 A and 4 A current-limit text. Its directly labelled nominal voltage is 7.4 V and its generic capacity is stored as stated 2200 mAh; no discharge-current limit is curated. Tenergy 31001 retains an erroneous generic parallel-module voltage claim, while its exact base-product nominal field supports 3.7 V. Tenergy 31012's application text mentions 10.8 V while its exact heading and nominal field state 11.1 V. These discrepancies remain visible, and no module-assembly procedure or application compatibility is accepted.

Jauch LP503759JU's family link tooltip names another model, but the exact family row and retrieved PDF body agree on LP503759JU / 246517. DEWALT DCBP320 has one alternate-image label for a two-pack; its selected SKU, included quantity and manual identify the single battery. EEMB LP583759's PDF prints the invalid date 2019-8-50, which is retained literally. These metadata limits were independently reopened without inventing corrections.

Inspired Energy NH2057HD34 revision 2.0 prints issue date 2/17/23 in headers and 2/17/22 in its revision history; the discrepancy is recorded. RRC and Inspired Energy capacity lower bounds retain their original >= labels in stated-capacity labels, evidence and notes. A numeric threshold is not an exact measured capacity. Initial rated, nominal, typical and minimum observations remain separate, and the complete structured record must be reviewed before applying a scalar from the candidate prefill view.

The five Duracell major/specialty cells have no selected capacity scalar: delivered capacity depends on load, temperature and cutoff, and plotted curves were not digitized. Their chemical evidence includes the exact sheets and the alkaline AIS family scope; specialty AAAA supports MX2500 independently of the major-size sub-brand list. Power-Sonic nominal capacities retain their explicit 20-hour rate and terminal option. School procurement coverage remains unknown.
<!-- later-source-limits:end -->

Manufacturer legal entity is not established for 158 records. Brand is independently populated for all 202 records; an official brand publisher is not silently asserted to be the legal factory. Shape codes are not precision dimensions. Some optional dimensions were not extracted even where drawings exist. No source establishes a particular asset's age, measured capacity, condition, charging equipment compatibility or school storage location.

Yuasa's dynamically produced PDFs were actually read, but browser retrieval was intermittent; direct HTTPS retrieval and in-memory extraction succeeded for NP7-12. Future generated PDFs may have another generation date or changed contents. The scripts do not re-fetch URLs or retain full downloaded documents. Re-open and review evidence when releasing an update. The current application mapping and this research are dated observations in a shared checkout; inspect current source again before integration.

## Build, validate and query

Run from the `battery-system` project root with Python 3.12 or later. Only standard-library modules are required; no project dependency or lockfile change is needed.

```powershell
python data/battery-catalog/assemble_catalog.py
python data/battery-catalog/catalog_tool.py build
python data/battery-catalog/catalog_tool.py validate --report data/battery-catalog/validation-report.json
python data/battery-catalog/catalog_tool.py query --search "Panasonic BK-3MCC"
python data/battery-catalog/catalog_tool.py query --brand Yuasa --exact-model NP7-12
python data/battery-catalog/catalog_tool.py query --id molicel-inr-18650-p28a
```

If `python` is not on PATH, invoke an installed Python executable by its absolute path. Validation here used bundled Python 3.12.14 / SQLite 3.53.1. SQLite must include its standard JSON functions.

Assembly reads the 21 files explicitly named in `assemble_catalog.py` INPUTS; staged fragments and audit records are excluded. It adds null defaults, preserves or supplies an editable display suggestion, normalizes variant-key punctuation and combines existing evidence without inventing specifications. Changed released content requires a new version and date; `--replace-draft` is restricted to unreleased drafts. Assembly rejects changes to any archived model/source objects. Canonical JSON is the SQLite build input. `catalog-plan.json` records the target and category allocation; `catalog-classification.json` assigns one editorial research category per record without altering factual model objects.

Database writes are constrained to `.sqlite3` targets within the catalog directory and will replace only an existing recognized reference database. Report output accepts only `validation-report.json` or `validation-report-<name>.json` within that directory. Connections are closed before Windows file replacement. Reads use parameterized SQL and read-only connections; wildcard characters in search are literal. Exact lookup trims whitespace and ignores case, without guessing punctuation, product suffixes or model equivalence. Every query returns the release version, content hash and `requires_variant_confirmation: true`.

The database contains `catalog_meta`, `models`, `sources`, `aliases`, `model_sources` and `field_evidence`. `models.record_json` retains the complete structured record; joins expose field-level provenance. A candidate SQL view, `inventory_prefill`, maps English labels, qualified rated capacity and nominal voltage, and always sets `prefill_review_required=1`. It includes verification status and is not an asset creation routine. The data-only `catalog_capacities` view exposes each non-null capacity separately with `kind`, `value_mah` and `source_label`. It preserves minimum/typical/stated values without relabelling them or changing the conservative prefill mapping. Generic labels describe the qualification; original wording and test conditions remain in each model's field evidence and structured fields.

```sql
SELECT catalog_id, model, capacityMah, voltage, capacity_basis, verification_status
FROM inventory_prefill WHERE catalog_id = 'yuasa-np7-12-faston-475mm-standard';

SELECT catalog_id, kind, value_mah, source_label
FROM catalog_capacities WHERE catalog_id = 'molicel-inr-21700-p50s';

SELECT e.field_path, e.locator, e.observation, s.url, s.document_version
FROM field_evidence e JOIN sources s USING(source_id)
WHERE e.catalog_id = 'molicel-inr-18650-p28a'
ORDER BY e.field_path, s.source_id;
```

Actual validation passed all 48 recorded checks for `2026.10.03.4`: schema/semantics, identities, units, evidence references, JSON/SQLite and numeric/null equality, capacity qualifications, content hash, reproducible database builds, read-only queries, negative-input guards, unique primary categories and archived model/source/file preservation. All 112 null rated/nominal values remain null in the prefill view. The recorded independent sample meets the planned minimum; that check verifies identifiers and sample size, not scientific accuracy. See `validation-report.json` for actual time and results. No D1 integration or application efficiency measurements are claimed.

Independent source sampling is separate from script validation. For archived release `2026.10.02.2`, `research/batch2-audit-standard-review.json` reopens P50S/P30S sheets and exact pages; `research/batch2-audit-lifepo4-review.json` independently reviews all four added LiFePO4 sources, including the LF105 limitation; `research/batch2-audit-root-review.json` records the additional Molicel, two Panasonic and three Tattu samples. Its final read-only data/database review also checked product counting and source URL counts. These are sampled source reviews, not a full second-source audit of every model. That archived release's one repeated URL is Panasonic's generic NiMH PSDS: its original source object retains its original applicability, and a separate batch-two source object records new applicability without altering the old release. Later batches may create additional source objects for a shared URL to preserve new applicability without rewriting historical objects. Current counts and batch samples appear above and in `catalog-review-log.json`. Script validation does not re-fetch sources.

## Registration workflow and current field mapping

The following design records the research handoff. Catalog data expansion itself implements no application workflow. The separate application follow-up described below implements part of this design; quantity expansion, alias search and catalog-linked CSV creation remain proposed.

1. Search brand, exact model/MPN and aliases. Display candidate model, distinguishing variant, capacity qualification, connector, source links, conflict notes and verification status. Include Clear filters. Generic matches remain candidates.
2. Staff confirms the received label and exact variant, including terminal/connector and product version. A typed MPN alone cannot confirm a variant. Do not automatically select a `partial` record or resolve its conflict. If the product cannot be established, offer quick manual registration immediately.
3. Suggest `name`, brand-qualified `model`, mapped `chemistry`, source-backed `rated_capacity_mah` and `nominal_voltage_v`. Show the source qualification with the value. Applying a model never overwrites manually entered values without field-level review. Minimum, typical and unqualified stated capacities are visible as reference information; the first-phase default leaves current `capacityMah` null when no rated/nominal/test-rated value exists. A later explicit staff choice to use another capacity basis must preserve its qualification and adapt the UI/export wording before saving it as a scalar.
4. Choose quantity and common responsible owner/storage once. Owner choices are active native staff account profiles in the selected shared inventory. Use the staff projection ID required by current `ownerId`; never match display names. Default storage building to J18; room may stay null and must be a selectable room of that building if chosen. Placeholder rooms remain labelled unverified.
5. Expand to one draft per physical asset, generate/review unique asset IDs and assign optional RFID tags individually. A retail carton of AA cells is a quantity of separate cells; an assembled pack is one asset unless the project explicitly chooses another tracking unit. Catalog ID is never substituted for an asset ID. Manufacturing/first-use dates remain individually unknown unless actual asset evidence exists; a shared date is only a staff-confirmed fact for that batch.
6. Review the complete batch once, including differences, unknowns, unique IDs, RFID assignments and source snapshot. Submit once within the current 1-200 record limit. Existing duplicate ID/tag guards, owner/location validation, actor attribution, atomic import and conflict handling remain authoritative. Show saved success only after the server result.

The five requested application files were inspected along with `lib/store.ts`, the current CSV template and task-plan schema on 2026-10-02:

| Existing application field | Catalog mapping / boundary |
| --- | --- |
| `name` | Suggested display name; editable per asset |
| `chemistry` | Controlled catalog code -> short English label |
| `model` | Suggested `{brand} {model}` text, subject to current 120-character limit; snapshot retains exact model and variant separately |
| `capacityMah` | `rated_capacity_mah` only under the initial conservative mapping; null is preserved |
| `voltage` | `nominal_voltage_v`, not maximum charge voltage |
| `id` | Newly generated/reviewed per physical asset; never copied from catalog |
| `tagId` | Actual optional tag assigned per asset; never shared across the quantity |
| `ownerId` | User-selected active native staff profile projection in the relevant shared inventory |
| `homeBuildingId`, `homeRoomId` | User-selected registered home; J18 and optional available room; never derived from a product source |
| `manufacturedOn`, `firstUsedOn` | Actual per-asset evidence or null; never source publication, lookup or registration date |
| Loans, charge records, observations, audit history | Individual transaction/observation evidence; never copied from a model |

`db/schema.ts` and `lib/domain.ts` currently have no catalog relationship, variant structure, source provenance, rechargeable flag or capacity-basis field. `RecordEditor` currently requires an entered asset ID/name and owner/storage selections. `ImportDialog` and `client-utils` currently accept reviewed CSV records, limit rows to 200, parse nullable numbers/dates and do not perform model lookup. The current CSV headers include `id`, `name`, `owner_id`, `storage_building_id` and `storage_room_id`; an optional room value may be blank even though its header is required. Server `importRecords` validates real owners, J18/room binding, dates and duplicate records before atomic insertion.

For unbranded, missing-model or self-built batteries, the quick path uses only a generated/reviewed asset ID, meaningful editable name, active owner and J18/optional room. Model/chemistry can be blank under the current application contract; unknown numeric/date/tag fields stay null. Staff may record known label facts without fabricating a catalog match. Later evidence supports a reasoned metadata correction with existing version/audit guards. After source review, a previously unknown commercial model may become a reusable catalog entry in a new release; it must not be guessed from the manual asset record. Catalog coverage must never become a closed list that blocks unknown or self-built asset registration. Similar voltage/capacity, appearance, AA/18650 labels or a `3S` marking never establish an exact product match.

## Catalog releases and immutable asset snapshots

Published artifacts are preserved under `data/battery-catalog/releases/<version>/`, each with raw-file SHA-256 manifest. Current release `2026.10.03.4` uses schema `1.1.0` and preserves every archived model/source object. The plan, editorial classification and source-review log are separate data artifacts; they do not add application functions.

Treat released catalog content as immutable. Stable `catalog_id` identifies the same variant across releases; an incompatible connector, case, capacity or successor variant receives a separate ID. A source edit or correction produces a new catalog release and content hash. `schema_version` changes independently when the contract changes. Canonical hashing uses UTF-8 JSON with sorted keys, compact separators and no non-finite numbers; it does not hash pretty-print whitespace. SQLite stores the same hash in `catalog_meta`.

At confirmed registration, the server should persist an immutable specification snapshot with each physical asset, in the same guarded transaction as its registration event. Proposed snapshot data includes:

- `snapshot_schema_version`, `catalog_id`, `catalog_version`, catalog `content_sha256`, and hash of the selected model record.
- Exact brand/model/variant, copied facts with units and capacity qualification, applied prefill field names, and all selected model/source/evidence records. Copy the records rather than keeping only a link to mutable catalog data.
- Staff account identity and UTC confirmation time, the staff's physical-label/variant confirmation, and any field override with reason and evidence.
- A nullable catalog reference and manual evidence path for unknown or self-built products.

The snapshot is product-reference evidence, not a measurement of that individual battery. Current asset metadata remains the working register; history retains the snapshot used at registration and subsequent reasoned corrections. A catalog refresh may show a review suggestion or diff, but cannot silently modify registered asset specifications, owner/location, dates, tags or transactions. A later staff-approved correction records old/new snapshot references and actual changed fields, loaded asset version, actor and reason. Export the snapshot and provenance along with asset details.

Existing `taskPlans`, `taskCycles` and `taskMessages` continue as separate records. Catalog lookup, registration and update must not create or activate a maintenance plan, compute a cycle, mark a task complete or turn manufacturer shelf-life claims into a recurrence interval. Source notes may be reviewed when a responsible person defines a plan and confirms applicability; they are never automatically applied.

## Limited first-phase application changes proposed

These are the original integration requirements, not changes performed by catalog research. See the application status below for the implemented subset.

1. Add a small server-side catalog reader/search adapter over the versioned JSON (simplest initial choice) or separately packaged SQLite reference. Provide authenticated candidate lookup using exact IDs and model/brand queries. Verify the release hash and keep catalog loading separate from the application's D1 binding. Do not assume that local SQLite files are directly available in the deployed worker.
2. Extend the registration/import draft UI with model search, source/variant confirmation, conservative prefill, quantity expansion, common owner/storage, unique per-asset ID/tag review, manual quick path and one final batch confirmation. Reuse current staff directory/location rules and the existing 200-row bound. The existing CSV import can remain available; it must not guess catalog links from free text.
3. Add only catalog-selection/snapshot request types and bounded server validation to the domain/store layer. The server must load the selected immutable release itself, verify exact model/variant/hash, reject changed reviewed content, validate allowed overrides and preserve existing account/inventory/version constraints. Client-supplied source or snapshot JSON is not authoritative. A retried batch must retain the same request identity and payload; never regenerate asset IDs after an uncertain write.
4. Use a reviewed migration for immutable per-asset specification snapshot records and asset linkage or an equivalent durable audited relation, with scope, same-inventory and audit/version guards. Do not mirror assets into a second inventory or rebuild existing history. Ensure normal future metadata editing cannot leave a catalog snapshot silently inconsistent with an unrecorded override. Extend detail/export output to include snapshots, applied capacity basis and evidence.
5. Validate the integrated flow against actual D1 semantics and the visible staff workflow: multiple assets share only stable product specs; unknown/manual registration works; minimum/typical values retain their labels; conflicting variants need review; stale catalog/owner/asset states and duplicate ID/tag batches fail atomically; updates preserve old snapshots and never activate tasks. Existing source and runtime tests must run after those changes.

This local catalog is ready as a reviewable input for that limited integration. Continuous monitoring, automatic maintenance rules, procurement synchronization and claims of measurable staff time saved remain outside the completed delivery.

## Application follow-up status

3 October 2026 · Requirements baseline 1.12 connects this unchanged catalog to optional single-battery registration through `lib/battery-reference-catalog.ts` and authenticated `/api/battery-models`. The server pins the research release and its JavaScript JSON-value representation separately, resolves exact reviewed model IDs/hashes and reconstructs complete selected model/source evidence. The asset registration audit retains that evidence, applied fields and per-asset overrides; complete operation-history exports include it. No catalog facts become physical stock, ownership, age, location or safety claims.

The form supports brand/model/variant label search, conservative field suggestions, explicit replacement of conflicting manual values and a manual quick path. Staff can also save reusable templates in their shared inventory; administrators can make versioned corrections. Template changes never cascade into registered batteries. Migration 0010 adds the template table without changing existing records. Quantity expansion, alias search, catalog-linked CSV/batch registration and dedicated on-screen model-evidence cards are not implemented by this follow-up. Existing batch checkout/return and reviewed CSV asset creation remain available.

The complete application suite passed 244 isolated tests, plus TypeScript, ESLint and the production build. These are code, component-handler and real-D1 checks; browser visual acceptance remains unavailable after a reported URL-policy rejection. See [model registration](model-registration.md) for current controls and [validation](validation.md) for actual results and limitations. The frozen 0.5.0 application tag remains unchanged.
