from __future__ import annotations

import json
import struct
import time
import zlib
from pathlib import Path

import h5py

ROOT = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-MAP-001\20260919T233638_AEST")
SOURCE = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
OUT = ROOT / "datasets"
MAX_HDF_DEPTH = 4
MAX_HDF_NODES = 500
MAX_LEVEL5_COMPRESSED_BYTES = 2 * 1024 * 1024
MAX_LEVEL5_DECOMPRESSED_BYTES = 8 * 1024 * 1024
MAX_SECONDS_PER_FILE = 10.0


def rows(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def permission(row):
    route = row["prior_routing"]
    effective = route["rights_record"]["effective_rights_id"]
    rights = row.get("existing_rights_records") or []
    exact = [r for r in rights if r.get("file_id") == row["file_id"] and r.get("file_sha256") == row["sha256_registered"] and r.get("ai_processing") == "ALLOWED"]
    group = [r for r in rights if not r.get("file_id") and r.get("source_id") == row["source_id"] and r.get("rights_id") == effective and r.get("ai_processing") == "ALLOWED"]
    match = exact or group
    if not match:
        return None
    binding = "EXACT_FILE_ID_AND_SHA256" if exact else "RECORDED_GROUP_SCOPE_FOR_EXACT_ACQUIRED_REPRESENTATIONS"
    return {"binding": binding, "rights_id": match[0]["rights_id"]}


def hdf_directory(path):
    nodes = []
    truncated = False
    with h5py.File(path, "r") as h:
        root_keys = list(h.keys())
        def walk(group, depth):
            nonlocal truncated
            if depth > MAX_HDF_DEPTH:
                truncated = True
                return
            for key in group.keys():
                if len(nodes) >= MAX_HDF_NODES:
                    truncated = True
                    return
                obj = group[key]
                record = {"path": obj.name, "kind": "group" if isinstance(obj, h5py.Group) else "dataset", "attribute_names": sorted(obj.attrs.keys())}
                if isinstance(obj, h5py.Dataset):
                    record.update({"shape": list(obj.shape), "dtype": str(obj.dtype), "chunks": list(obj.chunks) if obj.chunks else None, "compression": obj.compression})
                nodes.append(record)
                if isinstance(obj, h5py.Group):
                    walk(obj, depth + 1)
        walk(h, 1)
    return {"mat_generation": "MATLAB_7_3_HDF5", "root_keys": root_keys, "directory_nodes": nodes, "directory_node_count_observed": len(nodes), "limits": {"max_depth": MAX_HDF_DEPTH, "max_nodes": MAX_HDF_NODES}, "directory_truncated": truncated, "array_values_read": False}


def element(data, pos, endian="<"):
    if pos + 8 > len(data):
        return None
    first = struct.unpack_from(endian + "I", data, pos)[0]
    packed_len = first >> 16
    if packed_len:
        return first & 0xFFFF, packed_len, data[pos + 4:pos + 4 + packed_len], pos + 8
    dtype, size = first, struct.unpack_from(endian + "I", data, pos + 4)[0]
    start = pos + 8
    end = start + size
    return dtype, size, data[start:min(end, len(data))], start + ((size + 7) // 8) * 8


def matrix_meta(payload, endian="<"):
    pos = 0
    fields = []
    while pos + 8 <= len(payload) and len(fields) < 3:
        e = element(payload, pos, endian)
        if not e:
            break
        fields.append(e)
        if e[3] <= pos:
            break
        pos = e[3]
    if len(fields) < 3:
        return {"name": None, "shape": None, "class_id": None, "metadata_complete": False}
    flags, dims, name = fields[:3]
    class_id = struct.unpack_from(endian + "I", flags[2] + b"\0" * 4, 0)[0] & 0xFF if flags[2] else None
    dim_values = list(struct.unpack(endian + "i" * (len(dims[2]) // 4), dims[2])) if dims[2] and len(dims[2]) % 4 == 0 else None
    var_name = name[2].decode("utf-8", errors="replace") if name[2] else ""
    return {"name": var_name, "shape": dim_values, "class_id": class_id, "metadata_complete": bool(var_name and dim_values)}


def level5_directory(path):
    start = time.monotonic()
    out = []
    bytes_read = 128
    decompressed = 0
    truncated = False
    with path.open("rb") as f:
        header = f.read(128)
        endian = "<" if header[126:128] == b"IM" else ">"
        while time.monotonic() - start < MAX_SECONDS_PER_FILE:
            tag = f.read(8)
            bytes_read += len(tag)
            if len(tag) < 8:
                break
            dtype, size = struct.unpack(endian + "II", tag)
            if dtype == 14:
                take = min(size, MAX_LEVEL5_DECOMPRESSED_BYTES)
                payload = f.read(take)
                bytes_read += len(payload)
                out.append(matrix_meta(payload, endian))
                if take < size:
                    truncated = True
                    break
                pad = (-size) % 8
                f.seek(pad, 1)
                bytes_read += pad
            elif dtype == 15:
                take = min(size, MAX_LEVEL5_COMPRESSED_BYTES)
                compressed = f.read(take)
                bytes_read += len(compressed)
                dec = zlib.decompressobj().decompress(compressed, MAX_LEVEL5_DECOMPRESSED_BYTES)
                decompressed += len(dec)
                inner = element(dec, 0, endian)
                out.append(matrix_meta(inner[2], endian) if inner and inner[0] == 14 else {"name": None, "shape": None, "class_id": None, "metadata_complete": False})
                if take < size or len(dec) >= MAX_LEVEL5_DECOMPRESSED_BYTES:
                    truncated = True
                    break
                pad = (-size) % 8
                f.seek(pad, 1)
                bytes_read += pad
            else:
                f.seek(size + ((-size) % 8), 1)
                bytes_read += size + ((-size) % 8)
    if time.monotonic() - start >= MAX_SECONDS_PER_FILE:
        truncated = True
    return {"mat_generation": "MATLAB_LEVEL_5", "variable_directory": out, "variable_count_observed": len(out), "limits": {"max_compressed_bytes_per_element": MAX_LEVEL5_COMPRESSED_BYTES, "max_decompressed_bytes_per_element": MAX_LEVEL5_DECOMPRESSED_BYTES, "max_seconds_per_file": MAX_SECONDS_PER_FILE}, "bytes_read_or_skipped": bytes_read, "directory_truncated": truncated, "scipy_available": False, "array_values_read": False}


def main():
    scope = {r["file_id"]: r for r in rows(ROOT / "INPUT_SCOPE.jsonl")}
    mapping = rows(OUT / "MAPPING_FRAGMENT.jsonl")
    targets = [r for r in mapping if r["technical_format"] == "MAT"]
    assert len(targets) == 13
    results = []
    for mapped in targets:
        row = scope[mapped["file_id"]]
        permit = permission(row)
        if not permit:
            results.append({"file_id": mapped["file_id"], "status": "NOT_READ_NO_BINDING"})
            continue
        path = SOURCE / Path(row["relative_path"])
        generation = mapped["profile"]["mat_generation"]
        begun = time.monotonic()
        profile = hdf_directory(path) if generation == "MATLAB_7_3_HDF5" else level5_directory(path)
        results.append({"file_id": mapped["file_id"], "status": "DIRECTORY_METADATA_OBSERVED", "permission": permit, "elapsed_seconds": round(time.monotonic() - begun, 6), "profile": profile})
    (OUT / "MAT_SUPPLEMENT.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in results), encoding="utf-8")
    print(json.dumps({"targets": len(targets), "observed": sum(r["status"] == "DIRECTORY_METADATA_OBSERVED" for r in results), "generations": {g: sum((r.get("profile") or {}).get("mat_generation") == g for r in results) for g in ["MATLAB_7_3_HDF5", "MATLAB_LEVEL_5"]}, "truncated": sum(bool((r.get("profile") or {}).get("directory_truncated")) for r in results)}, indent=2))


if __name__ == "__main__":
    main()
