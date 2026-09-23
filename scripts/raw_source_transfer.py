#!/usr/bin/env python3
"""Import frozen raw sources as Git LFS pointers and restore selected originals.

The import streams each read-only source directly into git-lfs clean. Its working
tree output is the small pointer; the only full payload copy is the LFS object.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request


REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "data/catalogue/raw_source_transfer.jsonl"
CHUNK_BYTES = 2 * 1024**3
MAX_DIRECT_BYTES = 4_000_000_000
RESERVE_BYTES = 10 * 1024**3
BUFFER_BYTES = 8 * 1024**2
POINTER_RE = re.compile(
    rb"\Aversion https://git-lfs.github.com/spec/v1\n"
    rb"oid sha256:([0-9a-f]{64})\nsize ([0-9]+)\n\Z"
)


def safe_relative(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or any(p in ("", ".", "..") for p in value.split("/")):
        raise ValueError(f"unsafe relative path: {value!r}")
    if "\\" in value or ":" in value:
        raise ValueError(f"non-portable relative path: {value!r}")
    return path


def records(catalogue: Path):
    with catalogue.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if line.strip():
                row = json.loads(line)
                safe_relative(row["relative_path"])
                if not re.fullmatch(r"[0-9a-f]{64}", row["sha256"]):
                    raise ValueError(f"bad SHA-256 at {catalogue}:{line_number}")
                yield row


def source_path(root: Path, relative: PurePosixPath) -> Path:
    path = root.joinpath(*relative.parts)
    for component in (root, *(root.joinpath(*relative.parts[:i]) for i in range(1, len(relative.parts) + 1))):
        attributes = getattr(component.lstat(), "st_file_attributes", 0)
        if component.is_symlink() or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
            raise ValueError(f"source traverses symlink/junction: {component}")
    if not path.is_file():
        raise FileNotFoundError(f"missing or symlink source: {path}")
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"source escapes root: {path}")
    return path


def lfs_object(sha256: str) -> Path:
    return REPO / ".git/lfs/objects" / sha256[:2] / sha256[2:4] / sha256


def pointer_bytes(sha256: str, size: int) -> bytes:
    return ("version https://git-lfs.github.com/spec/v1\n"
            f"oid sha256:{sha256}\nsize {size}\n").encode("ascii")


def inspect_pointer(path: Path, sha256: str, size: int, require_object: bool) -> bool:
    if not path.exists():
        return False
    if path.is_symlink():
        raise ValueError(f"symlink destination: {path}")
    if path.stat().st_size > 200:
        raise ValueError(f"destination contains payload, expected LFS pointer: {path}")
    content = path.read_bytes()
    if content != pointer_bytes(sha256, size):
        raise ValueError(f"unexpected existing pointer at {path}")
    if require_object:
        object_path = lfs_object(sha256)
        if object_path.stat().st_size != size:
            raise ValueError(f"local LFS object missing or wrong size: {sha256}")
        digest = hashlib.sha256()
        with object_path.open("rb") as stream:
            while block := stream.read(BUFFER_BYTES):
                digest.update(block)
        if digest.hexdigest() != sha256:
            raise ValueError(f"local LFS object corrupt: {sha256}")
    return True


def stream_to_lfs(source, offset: int, length: int, repo_path: PurePosixPath,
                  whole_hash=None):
    if shutil.disk_usage(REPO).free < length + RESERVE_BYTES:
        raise RuntimeError(f"insufficient space to keep {RESERVE_BYTES} bytes reserve")
    process = subprocess.Popen(
        ["git", "lfs", "clean", "--", repo_path.as_posix()], cwd=REPO,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    digest = hashlib.sha256()
    remaining = length
    source.seek(offset)
    try:
        while remaining:
            block = source.read(min(BUFFER_BYTES, remaining))
            if not block:
                raise EOFError(f"source shortened during read: {repo_path}")
            digest.update(block)
            if whole_hash is not None:
                whole_hash.update(block)
            process.stdin.write(block)
            remaining -= len(block)
        process.stdin.close()
        pointer = process.stdout.read()
        error = process.stderr.read()
        code = process.wait()
        if code:
            raise RuntimeError(f"git lfs clean failed for {repo_path}: {error.decode(errors='replace')[:1000]}")
        match = POINTER_RE.fullmatch(pointer)
        if not match or match.group(1).decode() != digest.hexdigest() or int(match.group(2)) != length:
            raise ValueError(f"LFS pointer disagrees with streamed bytes: {repo_path}")
        return digest.hexdigest(), pointer
    except BaseException:
        process.kill()
        process.wait()
        raise
    finally:
        for pipe in (process.stdin, process.stdout, process.stderr):
            if pipe:
                pipe.close()


def put_pointer(destination: Path, pointer: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(destination)
    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".lfs-pointer-", delete=False) as temp:
        temp.write(pointer)
        temp_name = Path(temp.name)
    try:
        if destination.exists():
            raise FileExistsError(destination)
        os.link(temp_name, destination)
    finally:
        temp_name.unlink(missing_ok=True)


def import_sources(args) -> None:
    groups = [
        ("original_sources", Path(args.source_root), Path(args.primary_catalogue)),
        ("lithium_supplement", Path(args.supplement_root), Path(args.supplement_catalogue)),
    ]
    rows = []
    for group, root, catalogue in groups:
        for row in records(catalogue):
            relative = safe_relative(row["relative_path"])
            source = source_path(root, relative)
            total = int(row["bytes"])
            if source.stat().st_size != total:
                raise ValueError(f"source size changed: {source}")
            base = PurePosixPath("data/raw") / group / relative
            parts = []
            chunks = ((i, min(CHUNK_BYTES, total - i)) for i in range(0, total, CHUNK_BYTES)) if total > MAX_DIRECT_BYTES else ((0, total),)
            whole_hash = hashlib.sha256() if total > MAX_DIRECT_BYTES else None
            with source.open("rb") as stream:
                for number, (offset, length) in enumerate(chunks, 1):
                    target = (base.parent / (base.name + ".parts") / f"part-{number:05d}") if whole_hash else base
                    local = REPO.joinpath(*target.parts)
                    if local.exists():
                        # A retry still verifies the full source stream below.
                        stream.seek(offset)
                        digest = hashlib.sha256()
                        remaining = length
                        while remaining:
                            block = stream.read(min(BUFFER_BYTES, remaining))
                            if not block:
                                raise EOFError(source)
                            digest.update(block)
                            if whole_hash:
                                whole_hash.update(block)
                            remaining -= len(block)
                        part_sha = digest.hexdigest()
                        inspect_pointer(local, part_sha, length, require_object=True)
                    else:
                        part_sha, pointer = stream_to_lfs(stream, offset, length, target, whole_hash)
                        if whole_hash is None and part_sha != row["sha256"]:
                            raise ValueError(f"source SHA-256 changed: {source}")
                        put_pointer(local, pointer)
                    parts.append({"repo_path": target.as_posix(), "bytes": length, "sha256": part_sha})
            actual = whole_hash.hexdigest() if whole_hash else parts[0]["sha256"]
            if actual != row["sha256"]:
                raise ValueError(f"source SHA-256 changed: {source}")
            entry = {
                "source_set": group, "original_relative_path": relative.as_posix(),
                "bytes": total, "sha256": row["sha256"],
                "source_id": row.get("source_id"), "original_url": row.get("original_url"),
                "status": row.get("status", "QUARANTINED_PATH" if "quarantine" in relative.parts
                                  else "SOURCE_CATALOGUE_STATUS_UNSPECIFIED"), "parts": parts,
            }
            rows.append(entry)
            print(f"{len(rows)}/318 {group}/{relative} {total} bytes", flush=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=MANIFEST.parent,
                                     prefix=".raw-transfer-", delete=False) as temp:
        for entry in rows:
            temp.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")
        temporary = Path(temp.name)
    temporary.replace(MANIFEST)
    print(f"manifest: {MANIFEST}, {len(rows)} originals", flush=True)


def transfer_entries(manifest: Path):
    with manifest.open("r", encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def normalize_manifest(args) -> None:
    """Enrich an already imported manifest from frozen metadata, without source I/O."""
    catalogue = {}
    for group, path in (("original_sources", Path(args.primary_catalogue)),
                        ("lithium_supplement", Path(args.supplement_catalogue))):
        for row in records(path):
            key = (group, row["relative_path"])
            if key in catalogue:
                raise ValueError(f"duplicate catalogue key: {key}")
            catalogue[key] = row
    rows = list(transfer_entries(Path(args.manifest)))
    if len(rows) != len(catalogue) or len({(r["source_set"], r["original_relative_path"]) for r in rows}) != len(rows):
        raise ValueError("manifest/catalogue count or uniqueness mismatch")
    for entry in rows:
        key = (entry["source_set"], entry["original_relative_path"])
        row = catalogue[key]
        if entry["bytes"] != row["bytes"] or entry["sha256"] != row["sha256"]:
            raise ValueError(f"manifest/catalogue content mismatch: {key}")
        validated_parts(entry)
        relative = safe_relative(row["relative_path"])
        entry["source_id"] = row.get("source_id")
        entry["original_url"] = row.get("original_url")
        entry["status"] = row.get("status", "QUARANTINED_PATH" if "quarantine" in relative.parts
                                   else "SOURCE_CATALOGUE_STATUS_UNSPECIFIED")
    path = Path(args.manifest)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=path.parent,
                                     prefix=".raw-transfer-", delete=False) as temp:
        for entry in rows:
            temp.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")
        temporary = Path(temp.name)
    temporary.replace(path)
    print(f"normalized {len(rows)} records from frozen catalogues")


def validated_parts(entry):
    group = entry["source_set"]
    if group not in ("original_sources", "lithium_supplement"):
        raise ValueError("invalid source_set in manifest")
    relative = safe_relative(entry["original_relative_path"])
    base = PurePosixPath("data/raw") / group / relative
    total = int(entry["bytes"])
    parts = entry["parts"]
    expected_count = ((total + CHUNK_BYTES - 1) // CHUNK_BYTES) if total > MAX_DIRECT_BYTES else 1
    if len(parts) != expected_count:
        raise ValueError("incorrect part count")
    for number, part in enumerate(parts, 1):
        expected_path = (base.parent / (base.name + ".parts") / f"part-{number:05d}") if total > MAX_DIRECT_BYTES else base
        if safe_relative(part["repo_path"]) != expected_path:
            raise ValueError(f"unexpected part path: {part['repo_path']}")
        expected_bytes = min(CHUNK_BYTES, total - (number - 1) * CHUNK_BYTES) if total > MAX_DIRECT_BYTES else total
        if part["bytes"] != expected_bytes or not re.fullmatch(r"[0-9a-f]{64}", part["sha256"]):
            raise ValueError("invalid part size or SHA-256")
    return parts


def complete_manifest(path: Path):
    rows = list(transfer_entries(path))
    if len(rows) != 318 or sum(int(row["bytes"]) for row in rows) != 112476007760:
        raise ValueError("frozen manifest count or byte total mismatch")
    if len({(row["source_set"], row["original_relative_path"]) for row in rows}) != 318:
        raise ValueError("duplicate original in transfer manifest")
    for row in rows:
        validated_parts(row)
    return rows


def upload_objects(args) -> None:
    expected_remote()
    rows = complete_manifest(Path(args.manifest))
    objects = {}
    for row in rows:
        for part in row["parts"]:
            path = REPO.joinpath(*safe_relative(part["repo_path"]).parts)
            if not inspect_pointer(path, part["sha256"], part["bytes"], require_object=False):
                raise FileNotFoundError(path)
            object_path = lfs_object(part["sha256"])
            if object_path.stat().st_size != part["bytes"]:
                raise ValueError(f"missing or wrong-size LFS object: {part['repo_path']}")
            objects[part["sha256"]] = part["bytes"]
    ordered = list(objects)
    uploaded = 0
    for start in range(0, len(ordered), 20):
        batch = ordered[start:start + 20]
        result = subprocess.run(["git", "lfs", "push", "--object-id", "origin", *batch],
                                cwd=REPO, capture_output=True, text=True)
        if result.returncode:
            # Signed transfer URLs can appear in stderr; keep them out of shared output.
            raise RuntimeError(f"LFS object upload batch {start // 20 + 1} failed (exit {result.returncode}); "
                               "inspect the local Git LFS error log for details")
        uploaded += sum(objects[sha] for sha in batch)
        print(f"uploaded batch {start // 20 + 1}: {start + len(batch)}/{len(ordered)} objects, "
              f"{uploaded}/{sum(objects.values())} bytes requested", flush=True)


def remote_snapshot(manifest: Path):
    rows = complete_manifest(manifest)
    objects = {}
    for row in rows:
        for part in row["parts"]:
            objects[part["sha256"]] = part["bytes"]
    available = {}
    ordered = list(objects.items())
    for start in range(0, len(ordered), 100):
        items, status = lfs_batch_many(ordered[start:start + 100], "download", allow_missing=True)
        if status != 200:
            raise RuntimeError(f"LFS metadata HTTP {status}")
        for item in items:
            if "error" in item:
                continue
            action = item.get("actions", {}).get("download", {})
            if not action.get("href", "").startswith("https://"):
                raise ValueError("remote download action missing or insecure")
            available[item["oid"]] = item["size"]
    return {"available_objects": len(available), "expected_objects": len(objects),
            "available_bytes": sum(available.values()), "expected_bytes": sum(objects.values()),
            "missing_objects": len(objects) - len(available)}


def remote_status(args) -> None:
    print(json.dumps(remote_snapshot(Path(args.manifest)), sort_keys=True), flush=True)


def remote_check(args) -> None:
    snapshot = remote_snapshot(Path(args.manifest))
    print(json.dumps(snapshot, sort_keys=True), flush=True)
    if snapshot["missing_objects"]:
        raise ValueError("remote LFS upload is incomplete")


def stage_raw(args) -> None:
    """Stage only manifest-listed pointers, then compare every index blob."""
    rows = complete_manifest(Path(args.manifest))
    expected = {part["repo_path"]: pointer_bytes(part["sha256"], part["bytes"])
                for row in rows for part in row["parts"]}
    if len(expected) != sum(len(row["parts"]) for row in rows):
        raise ValueError("duplicate raw path in manifest")
    paths = list(expected)
    for start in range(0, len(paths), 20):
        subprocess.run(["git", "add", "--", *paths[start:start + 20]], cwd=REPO,
                       check=True, capture_output=True)
    result = subprocess.run(["git", "ls-files", "--cached", "-z", "--", "data/raw"],
                            cwd=REPO, check=True, capture_output=True).stdout
    actual = {path.decode("utf-8") for path in result.split(b"\0") if path}
    if actual != set(expected):
        raise ValueError(f"staged raw path set mismatch: expected {len(expected)}, got {len(actual)}")
    for path in paths:
        staged = subprocess.run(["git", "show", ":" + path], cwd=REPO,
                                check=True, capture_output=True).stdout
        if staged != expected[path]:
            raise ValueError(f"staged raw blob differs from manifest pointer: {path}")
    print(f"staged and verified {len(paths)} exact raw pointer paths; no refs changed")


def selected_entry(manifest: Path, source_set: str, relative: str):
    safe_relative(relative)
    matches = [r for r in transfer_entries(manifest)
               if r["source_set"] == source_set and r["original_relative_path"] == relative]
    if len(matches) != 1:
        raise ValueError(f"expected one manifest entry, found {len(matches)}")
    return matches[0]


def verify_pointer(args) -> None:
    entry = selected_entry(Path(args.manifest), args.source_set, args.relative_path)
    for part in validated_parts(entry):
        path = REPO.joinpath(*safe_relative(part["repo_path"]).parts)
        if not inspect_pointer(path, part["sha256"], part["bytes"], require_object=False):
            raise FileNotFoundError(path)
        print(part["repo_path"])


def preflight(args) -> None:
    """Ask the LFS upload batch API for metadata; never PUT object content."""
    target = REPO.joinpath(*safe_relative(args.repo_path).parts)
    pointer = target.read_bytes()
    match = POINTER_RE.fullmatch(pointer)
    if not match:
        raise ValueError(f"not an LFS pointer: {target}")
    item, status = lfs_batch(match.group(1).decode(), int(match.group(2)), "upload")
    print(f"LFS metadata HTTP {status}; upload action available: {bool(item.get('actions', {}).get('upload'))}; object size {item.get('size')}")


def expected_remote() -> str:
    remote = subprocess.run(["git", "remote", "get-url", "origin"], cwd=REPO,
                            capture_output=True, text=True, check=True).stdout.strip()
    expected = "https://github.com/DESN-Group-F/bsc-f2a5cc56.git"
    if remote != expected:
        raise ValueError(f"unexpected remote: {remote}")
    return expected


def lfs_batch_many(requested, operation: str, allow_missing: bool = False):
    expected = expected_remote()
    requested_objects = dict(requested)
    if not requested_objects or len(requested_objects) != len(requested) or len(requested) > 100:
        raise ValueError("expected 1 to 100 unique LFS objects")
    credentials = subprocess.run(["git", "credential", "fill"], cwd=REPO,
                                 input=b"protocol=https\nhost=github.com\n\n",
                                 capture_output=True, check=True).stdout.decode()
    fields = dict(line.split("=", 1) for line in credentials.splitlines() if "=" in line)
    if not fields.get("username") or not fields.get("password"):
        raise RuntimeError("Git credential helper returned no username/password")
    auth = base64.b64encode((fields["username"] + ":" + fields["password"]).encode()).decode()
    body = json.dumps({"operation": operation, "transfers": ["basic"],
                       "objects": [{"oid": sha, "size": size} for sha, size in requested]}).encode()
    request = urllib.request.Request(
        expected + "/info/lfs/objects/batch", data=body, method="POST",
        headers={"Authorization": "Basic " + auth,
                 "Accept": "application/vnd.git-lfs+json",
                 "Content-Type": "application/vnd.git-lfs+json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
            status = response.status
    except urllib.error.HTTPError as error:
        # Never emit response bodies: they may contain signed URLs or tokens.
        raise RuntimeError(f"LFS batch metadata HTTP {error.code}") from None
    objects = result.get("objects", [])
    if len(objects) != len(requested_objects) or {item.get("oid") for item in objects} != set(requested_objects):
        raise ValueError("LFS batch response does not match requested objects")
    for item in objects:
        if "error" in item:
            code = item["error"].get("code")
            if allow_missing and code == 404:
                continue
            raise RuntimeError(f"LFS batch rejected object (code {code})")
        if item.get("size") != requested_objects[item["oid"]]:
            raise ValueError("LFS batch returned an unexpected object size")
    return objects, status


def lfs_batch(sha256: str, size: int, operation: str):
    items, status = lfs_batch_many([(sha256, size)], operation)
    return items[0], status


def readback(args) -> None:
    """Independently stream one remote LFS object and verify its SHA, retaining no copy."""
    target = REPO.joinpath(*safe_relative(args.repo_path).parts)
    match = POINTER_RE.fullmatch(target.read_bytes())
    if not match:
        raise ValueError(f"not an LFS pointer: {target}")
    sha256, size = match.group(1).decode(), int(match.group(2))
    item, status = lfs_batch(sha256, size, "download")
    action = item.get("actions", {}).get("download")
    if not action or not action.get("href", "").startswith("https://"):
        raise RuntimeError("LFS download action unavailable or insecure")
    request = urllib.request.Request(action["href"], headers=action.get("header", {}))
    digest = hashlib.sha256()
    count = 0
    with urllib.request.urlopen(request, timeout=60) as response:
        while block := response.read(BUFFER_BYTES):
            digest.update(block)
            count += len(block)
    if count != size or digest.hexdigest() != sha256:
        raise ValueError("remote LFS readback size or SHA-256 mismatch")
    print(f"remote LFS readback verified: {count} bytes; batch HTTP {status}")


def reassemble(args) -> None:
    entry = selected_entry(Path(args.manifest), args.source_set, args.relative_path)
    output = Path(args.output)
    if output.exists() or output.is_symlink():
        raise FileExistsError(f"refusing to overwrite: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    whole = hashlib.sha256()
    total = 0
    with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".reassemble-", delete=False) as temp:
        temporary = Path(temp.name)
        try:
            for part in validated_parts(entry):
                path = REPO.joinpath(*safe_relative(part["repo_path"]).parts)
                length = path.stat().st_size
                if length != part["bytes"]:
                    raise ValueError(f"part not fetched or wrong size: {part['repo_path']}")
                digest = hashlib.sha256()
                with path.open("rb") as input_stream:
                    while block := input_stream.read(BUFFER_BYTES):
                        digest.update(block)
                        whole.update(block)
                        temp.write(block)
                        total += len(block)
                if digest.hexdigest() != part["sha256"]:
                    raise ValueError(f"part SHA-256 mismatch: {part['repo_path']}")
            if total != entry["bytes"] or whole.hexdigest() != entry["sha256"]:
                raise ValueError("original size or SHA-256 mismatch")
        except BaseException:
            temp.close()
            temporary.unlink(missing_ok=True)
            raise
    if output.exists() or output.is_symlink():
        temporary.unlink(missing_ok=True)
        raise FileExistsError(f"refusing to overwrite: {output}")
    try:
        os.link(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"verified {total} bytes: {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    importing = sub.add_parser("import", help="stream frozen originals into local LFS objects")
    importing.add_argument("--source-root", required=True)
    importing.add_argument("--primary-catalogue", required=True)
    importing.add_argument("--supplement-root", required=True)
    importing.add_argument("--supplement-catalogue", required=True)
    importing.set_defaults(func=import_sources)
    normalize = sub.add_parser("normalize-manifest", help="refresh statuses and provenance from frozen catalogues")
    normalize.add_argument("--manifest", default=str(MANIFEST))
    normalize.add_argument("--primary-catalogue", required=True)
    normalize.add_argument("--supplement-catalogue", required=True)
    normalize.set_defaults(func=normalize_manifest)
    uploading = sub.add_parser("upload-objects", help="upload all verified local objects without pushing refs")
    uploading.add_argument("--manifest", default=str(MANIFEST))
    uploading.set_defaults(func=upload_objects)
    checking_all = sub.add_parser("remote-check", help="verify all remote LFS download metadata without payload download")
    checking_all.add_argument("--manifest", default=str(MANIFEST))
    checking_all.set_defaults(func=remote_check)
    progress = sub.add_parser("remote-status", help="report uploaded object count and bytes without downloading payloads")
    progress.add_argument("--manifest", default=str(MANIFEST))
    progress.set_defaults(func=remote_status)
    staging = sub.add_parser("stage-raw", help="stage only manifest-listed LFS pointers and verify index")
    staging.add_argument("--manifest", default=str(MANIFEST))
    staging.set_defaults(func=stage_raw)
    for name, func in (("verify-pointer", verify_pointer), ("reassemble", reassemble)):
        command = sub.add_parser(name)
        command.add_argument("--manifest", default=str(MANIFEST))
        command.add_argument("--source-set", choices=("original_sources", "lithium_supplement"), required=True)
        command.add_argument("--relative-path", required=True)
        if name == "reassemble":
            command.add_argument("--output", required=True)
        command.set_defaults(func=func)
    checking = sub.add_parser("preflight", help="check LFS batch upload metadata without uploading bytes")
    checking.add_argument("--repo-path", required=True)
    checking.set_defaults(func=preflight)
    read = sub.add_parser("readback", help="independently verify one remote LFS object")
    read.add_argument("--repo-path", required=True)
    read.set_defaults(func=readback)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
