PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;
CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sources (
    source_id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL,
    publisher TEXT NOT NULL, source_type TEXT NOT NULL, document_version TEXT,
    accessed_on TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json))
);
CREATE TABLE models (
    catalog_id TEXT PRIMARY KEY, brand TEXT NOT NULL, manufacturer TEXT,
    model TEXT NOT NULL, variant_key TEXT NOT NULL, variant_description TEXT NOT NULL,
    chemistry TEXT NOT NULL, rechargeable INTEGER CHECK(rechargeable IN (0,1)),
    unit_kind TEXT NOT NULL CHECK(unit_kind IN ('cell','pack')), form_factor_code TEXT NOT NULL,
    rated_capacity_mah REAL CHECK(rated_capacity_mah IS NULL OR rated_capacity_mah > 0),
    capacity_basis TEXT NOT NULL, typical_capacity_mah REAL, minimum_capacity_mah REAL,
    stated_capacity_mah REAL, stated_capacity_label TEXT,
    nominal_voltage_v REAL CHECK(nominal_voltage_v IS NULL OR nominal_voltage_v > 0),
    energy_wh REAL, verification_status TEXT NOT NULL,
    search_text TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)),
    UNIQUE(brand,model,variant_key)
);
CREATE TABLE aliases (
    catalog_id TEXT NOT NULL REFERENCES models(catalog_id), value TEXT NOT NULL,
    kind TEXT NOT NULL, match_policy TEXT NOT NULL CHECK(match_policy IN ('exact_candidate','search_only')),
    PRIMARY KEY(catalog_id,value,kind)
);
CREATE TABLE model_sources (
    catalog_id TEXT NOT NULL REFERENCES models(catalog_id),
    source_id TEXT NOT NULL REFERENCES sources(source_id), PRIMARY KEY(catalog_id,source_id)
);
CREATE TABLE field_evidence (
    catalog_id TEXT NOT NULL REFERENCES models(catalog_id), field_path TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES sources(source_id), locator TEXT NOT NULL, observation TEXT NOT NULL,
    PRIMARY KEY(catalog_id,field_path,source_id,locator,observation),
    FOREIGN KEY(catalog_id,source_id) REFERENCES model_sources(catalog_id,source_id)
);
CREATE INDEX idx_models_identity ON models(brand,model);
CREATE INDEX idx_alias_value ON aliases(value COLLATE NOCASE);
CREATE INDEX idx_models_chemistry ON models(chemistry);
CREATE VIEW inventory_prefill AS
SELECT catalog_id, brand || ' ' || model AS model,
    CASE chemistry
        WHEN 'alkaline_zinc_manganese_dioxide' THEN 'Alkaline'
        WHEN 'lithium_iron_disulfide' THEN 'Li-FeS2'
        WHEN 'nickel_metal_hydride' THEN 'NiMH'
        WHEN 'lithium_ion' THEN 'Li-ion'
        WHEN 'lithium_ion_polymer' THEN 'LiPo'
        WHEN 'lithium_iron_phosphate' THEN 'LiFePO4'
        WHEN 'lead_acid' THEN 'Lead-acid'
    END AS chemistry,
    rated_capacity_mah AS capacityMah, nominal_voltage_v AS voltage, capacity_basis,
    verification_status, 1 AS prefill_review_required
FROM models;
CREATE VIEW catalog_capacities AS
SELECT catalog_id, rated_capacity_mah AS value_mah, capacity_basis AS kind,
    CASE capacity_basis WHEN 'nominal' THEN 'Nominal capacity' ELSE 'Rated/test-rate capacity' END AS source_label
FROM models WHERE rated_capacity_mah IS NOT NULL
UNION ALL
SELECT catalog_id, minimum_capacity_mah, 'minimum', 'Minimum capacity'
FROM models WHERE minimum_capacity_mah IS NOT NULL
UNION ALL
SELECT catalog_id, typical_capacity_mah, 'typical', 'Typical capacity'
FROM models WHERE typical_capacity_mah IS NOT NULL
UNION ALL
SELECT catalog_id, stated_capacity_mah, 'stated', stated_capacity_label
FROM models WHERE stated_capacity_mah IS NOT NULL;
