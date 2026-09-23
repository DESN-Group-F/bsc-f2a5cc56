# Source data and prepared-data locator

The upload of the approved 300 original objects and 18 lithium-supplement captures is complete. They total 112.48 GB (112,476,007,760 bytes) and are stored in this private repository under `data/raw/` using Git LFS. The transfer manifest is `data/catalogue/raw_source_transfer.jsonl`. It records source set, original relative path, registered bytes and SHA-256, status, and ordered stored parts. A repository checkout can hold LFS pointers without downloading source content. Test authors can retrieve relevant raw sources; a full collection download is not required.

## Raw-source layout

- The `data/raw/original_sources/` tree holds all 300 registered original objects. Most use their original relative path; three oversized originals are stored losslessly as 25 parts in total, in adjacent `<filename>.parts/` folders named `part-00001`, `part-00002`, and so on. Use the manifest's ordered part list and the transfer utility to reconstruct one for an authorised task.
- `data/raw/lithium_supplement/<supplement relative path>` holds 18 supplement records, including status-marked failed or quarantined captures. Reused sources from the original collection are not duplicated.

The registered total is 112,476,007,760 bytes across both sets. The source catalogues under `data/catalogue/` retain registered identity, location, hash, size, URL and status. Archival presence does not make a source usable evidence: preserve the ULRI exclusion and failed-response exclusion, and apply the recorded source/version/action decisions before indexing, model-context use, training, redistribution or server transfer. See [source-use notes](catalogue/SOURCE_USE_NOTES.md) for the key recorded restrictions and uncertainties.

For a new checkout, install Git LFS, then use a skip-smudge clone to avoid a collection-wide download. In PowerShell:

```powershell
git lfs install
$env:GIT_LFS_SKIP_SMUDGE = '1'
git clone https://github.com/DESN-Group-F/bsc-f2a5cc56.git
Remove-Item Env:\GIT_LFS_SKIP_SMUDGE
```

Fetch only paths needed for an assigned task. From the clone root, use `python scripts/raw_source_transfer.py verify-pointer --source-set original_sources --relative-path "<original relative path>"` to see the exact stored LFS path or ordered part paths. For a direct file, run `git lfs pull --include='data/raw/original_sources/<exact path>' --exclude=''`. For an oversized object, include its `.parts/*` paths, then run `python scripts/raw_source_transfer.py reassemble --source-set original_sources --relative-path "<original relative path>" --output "<chosen output path>"`. The utility checks the ordered parts and reconstructed original against the manifest; keep the reconstructed copy outside the repository. Do not run an unrestricted `git lfs pull` merely to draft tests.

## Prepared and derived data

Accepted local preparation runs remain under `data_preparation/`, including `CR-LITHIUM-COVERAGE-001/20260921T043456_AEST`. Processed content, experimental profiles, extracted full text and other derived artifacts remain outside Git. Authored processing scripts may be shared, but a prepared payload requires a separate purpose-specific selection and permission decision. Neither a raw-source checkout nor a local extraction grants RAG, training, redistribution or server-transfer approval.

For database work, copy `config/data_locations.example.json` to ignored `config/data_locations.json` and configure only the needed paths. Its repository-relative raw roots are archive locators, not processing inputs: a skip-smudge checkout holds LFS pointers, and three oversized originals exist only as parts. Fetch and verify selected files, reassemble a split original when needed, then set `source_workspace` to a materialized read-only input location for that task. A full download is unnecessary. Historical scripts retain original run paths and do not automatically read the registry. Test authors can leave local settings unconfigured. Keep personal settings and credentials out of shared examples.
