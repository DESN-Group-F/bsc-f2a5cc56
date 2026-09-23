"""Index preparation artifacts, excluding installed runtimes and transient caches.

This is a local review index, not a source-transfer or RAG-admission allowlist.
"""
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime

RUN = Path(__file__).resolve().parent
SKIP_DIRS = {".mcos_venv", ".venv", "__pycache__", ".cache", "tmp", "temp", ".tmp"}
OUTPUTS = {"ARTIFACT_INDEX.json", "ARTIFACT_INDEX.jsonl"}


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main():
    items = []
    skipped_empty_renders = []
    for base, directories, files in os.walk(RUN, followlinks=False):
        directories[:] = [name for name in directories if name not in SKIP_DIRS and not (Path(base) / name).is_symlink()]
        for name in sorted(files):
            path = Path(base) / name
            rel = path.relative_to(RUN).as_posix()
            if name in OUTPUTS or path.is_symlink():
                continue
            size = path.stat().st_size
            if size == 0 and path.suffix.lower() in {".png", ".jpg", ".jpeg"}:
                skipped_empty_renders.append(rel)
                continue
            items.append({"path": rel, "absolute_path": path.as_posix(), "bytes": size,
                          "sha256": digest(path), "purpose": "LOCAL_PREPARATION_OR_AUDIT_EVIDENCE",
                          "transfer_or_index_admission": "NOT_GRANTED_BY_THIS_INDEX"})
    items.sort(key=lambda row: row['path'])
    (RUN / "ARTIFACT_INDEX.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in items), encoding='utf-8')
    summary = {"created_at": datetime.now().astimezone().isoformat(), "status": "LOCAL_FILE_INDEX_ONLY",
               "file_count": len(items), "bytes": sum(row['bytes'] for row in items),
               "sha256_of_jsonl": digest(RUN / "ARTIFACT_INDEX.jsonl"),
               "excluded_runtime_and_cache_directory_names": sorted(SKIP_DIRS),
               "excluded_empty_render_files": skipped_empty_renders,
               "external_roots": str(RUN / "ROOTS.json"),
               "original_input_index": str(RUN / "SOURCE_OBJECTS.jsonl"),
               "prior_derivative_references": "BUILD_INPUT_INDEX.jsonl and each lane manifest; references are not silently duplicated",
               "not_authorized_by_index": ["server upload", "RAG or model ingestion", "training", "publication"]}
    (RUN / "ARTIFACT_INDEX.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding='utf-8')
    print(json.dumps({"files": len(items), "bytes": summary['bytes']}))


if __name__ == '__main__':
    main()
