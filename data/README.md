# Local data map

The data payload is deliberately outside Git. This directory contains documentation and lean catalogues only.

## Original source workspace

Local reference location used during preparation:

`E:/desn 2000/data/battery_data_workspace_v0_3`

It contains 300 registered original objects totalling about 112.42 GB and remains read-only input. `catalogue/source_objects.jsonl` is a reduced view produced from the accepted `CR-DATA-READY-001/20260920T012405_AEST/SOURCE_OBJECTS.jsonl`; the original workspace was not rescanned or rehashed for Git preparation.

Each catalogue row contains only `file_id`, `source_id`, source-relative path, registered SHA-256, registered bytes and original URL. It contains no source text or derived facts.

## Lithium supplement locations

The accepted local coverage run is:

`data_preparation/CR-LITHIUM-COVERAGE-001/20260921T043456_AEST`

Source payload locations within that local run are:

- `products/sources/` — manufacturer pages and PDFs; includes one failed HTML response explicitly excluded by status;
- `background/sources/` — the accepted DOE background PDF;
- `audits/quarantine/` — the excluded ULRI capture, retained only for incident evidence.

These directories are ignored and are not pushed. `catalogue/lithium_supplement_sources.jsonl` records the local run-relative location, registered hash, byte count, source URL and status for the locally held supplement captures. Reused sources that already belong to the original workspace are represented by the original catalogue instead of duplicated.

## Prepared and derived data

Processed content, experimental profiles, extracted full text and other derived artifacts remain under local `data_preparation/` run directories. Authored processing scripts remain eligible for Git, but payloads must be connected later through a purpose-specific manifest. Their existence does not grant RAG, training, redistribution or server-transfer permission.

Copy `config/data_locations.example.json` to the ignored `config/data_locations.json` and update it for each machine. This file is currently a path registry, not an implemented runtime configuration interface: historical scripts retain their original machine/run paths and do not automatically read it. Do not edit the example with personal paths or credentials.
