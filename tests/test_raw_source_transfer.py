"""Integrity checks for selective raw-source retrieval; no network or corpus reads."""

import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "raw_source_transfer", Path(__file__).resolve().parents[1] / "scripts/raw_source_transfer.py"
)
transfer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(transfer)


def sha(data):
    return hashlib.sha256(data).hexdigest()


class RawTransferTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.addCleanup(patch.stopall)
        patch.object(transfer, "REPO", self.root).start()
        patch.object(transfer, "MAX_DIRECT_BYTES", 8).start()
        patch.object(transfer, "CHUNK_BYTES", 4).start()
        self.data = b"complete original"
        self.entry = {
            "source_set": "original_sources", "original_relative_path": "example.bin",
            "bytes": len(self.data), "sha256": sha(self.data), "parts": [],
        }
        for number, start in enumerate(range(0, len(self.data), 4), 1):
            content = self.data[start:start + 4]
            path = f"data/raw/original_sources/example.bin.parts/part-{number:05d}"
            part = {"repo_path": path, "bytes": len(content), "sha256": sha(content)}
            self.entry["parts"].append(part)
            local = self.root / path
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(content)
        self.manifest = self.root / "manifest.jsonl"
        self.output = self.root / "restored/example.bin"
        self.args = SimpleNamespace(manifest=str(self.manifest), source_set="original_sources",
                                    relative_path="example.bin", output=str(self.output))

    def write_manifest(self):
        self.manifest.write_text(json.dumps(self.entry) + "\n", encoding="utf-8")

    def restore(self):
        self.write_manifest()
        with patch("sys.stdout", new=io.StringIO()):
            transfer.reassemble(self.args)

    def assert_no_partial_output(self):
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.glob(".reassemble-*")), [])

    def test_split_original_round_trip(self):
        self.restore()
        self.assertEqual(self.output.read_bytes(), self.data)

    def test_corrupt_part_is_rejected_and_temporary_output_removed(self):
        (self.root / self.entry["parts"][0]["repo_path"]).write_bytes(b"bad!")
        with self.assertRaisesRegex(ValueError, "part SHA-256 mismatch"):
            self.restore()
        self.assert_no_partial_output()

    def test_wrong_whole_digest_is_rejected(self):
        self.entry["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "original size or SHA-256 mismatch"):
            self.restore()
        self.assert_no_partial_output()

    def test_wrong_part_size_is_rejected(self):
        (self.root / self.entry["parts"][0]["repo_path"]).write_bytes(b"short")
        with self.assertRaisesRegex(ValueError, "not fetched or wrong size"):
            self.restore()
        self.assert_no_partial_output()

    def test_existing_output_is_preserved(self):
        self.output.parent.mkdir()
        self.output.write_bytes(b"keep me")
        with self.assertRaises(FileExistsError):
            self.restore()
        self.assertEqual(self.output.read_bytes(), b"keep me")

    def test_part_order_and_source_binding_are_enforced(self):
        for kind in ("reordered", "other_source", "missing"):
            entry = copy.deepcopy(self.entry)
            if kind == "reordered":
                entry["parts"].reverse()
            elif kind == "other_source":
                entry["parts"][0]["repo_path"] = "data/raw/original_sources/other.bin"
            else:
                entry["parts"].pop()
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                transfer.validated_parts(entry)

    def test_unsafe_paths_are_rejected(self):
        for path in ("", "../x", "/x", "a/../b", "a//b", "./x", "a/", "C:/x", "a\\b"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                transfer.safe_relative(path)

    def test_missing_pointer_is_rejected(self):
        self.entry = {"source_set": "original_sources", "original_relative_path": "small.bin",
                      "bytes": 3, "sha256": sha(b"abc"),
                      "parts": [{"repo_path": "data/raw/original_sources/small.bin",
                                 "bytes": 3, "sha256": sha(b"abc")} ]}
        self.write_manifest()
        self.args.relative_path = "small.bin"
        with self.assertRaises(FileNotFoundError):
            transfer.verify_pointer(self.args)

    def test_corrupt_local_lfs_object_cannot_be_resumed(self):
        digest = sha(b"good")
        pointer = self.root / "pointer"
        pointer.write_bytes(transfer.pointer_bytes(digest, 4))
        obj = transfer.lfs_object(digest)
        obj.parent.mkdir(parents=True)
        obj.write_bytes(b"evil")
        with self.assertRaisesRegex(ValueError, "local LFS object corrupt"):
            transfer.inspect_pointer(pointer, digest, 4, require_object=True)

    def test_remote_snapshot_reports_missing_without_counting_duplicate(self):
        rows = [self.entry, self.entry]
        known = self.entry["parts"][0]
        def response(requested, operation, allow_missing=False):
            self.assertEqual(operation, "download")
            self.assertTrue(allow_missing)
            return [({"oid": digest, "size": size,
                      "actions": {"download": {"href": "https://example.invalid/object"}}}
                     if digest == known["sha256"] else
                     {"oid": digest, "size": size, "error": {"code": 404}})
                    for digest, size in requested], 200
        with patch.object(transfer, "complete_manifest", return_value=rows), \
             patch.object(transfer, "lfs_batch_many", side_effect=response):
            snapshot = transfer.remote_snapshot(self.manifest)
        self.assertEqual(snapshot["available_objects"], 1)
        self.assertEqual(snapshot["available_bytes"], known["bytes"])
        self.assertEqual(snapshot["expected_objects"], len(self.entry["parts"]))
        self.assertEqual(snapshot["missing_objects"], len(self.entry["parts"]) - 1)

    def test_remote_check_rejects_incomplete_upload(self):
        with patch.object(transfer, "remote_snapshot", return_value={"missing_objects": 1}), \
             patch("sys.stdout", new=io.StringIO()), self.assertRaisesRegex(ValueError, "incomplete"):
            transfer.remote_check(self.args)

    def test_unexpected_remote_cannot_start_upload(self):
        result = SimpleNamespace(stdout="https://github.com/unrelated/project.git\n")
        with patch.object(transfer.subprocess, "run", return_value=result) as command, \
             self.assertRaisesRegex(ValueError, "unexpected remote"):
            transfer.upload_objects(self.args)
        self.assertEqual(command.call_count, 1)


if __name__ == "__main__":
    unittest.main()
