"""Small executable numerical/budget fixtures for the native image entry point."""
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path
import numpy as np
from PIL import Image
from native_image_reader import read_image_member

HERE = Path(__file__).resolve().parent


def main():
    checks = []
    temporary_root = HERE / ".tmp"
    temporary_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=temporary_root) as temporary:
        target = Path(temporary)
        if not target.resolve().is_relative_to(temporary_root.resolve()):
            raise ValueError("unexpected fixture directory")
        arrays = [np.array([[0, 1000, 65535], [1 + n, 40000, 42]], dtype=np.uint16) for n in range(3)]
        frames = [Image.fromarray(array) for array in arrays]
        frames[0].save(target / "frames.tiff", save_all=True, append_images=frames[1:])
        with zipfile.ZipFile(target / "fixture.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(target / "frames.tiff", "frames.tiff")
            archive.writestr("directory/", b"")
        path = target / "fixture.zip"
        original_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        for number, expected in enumerate(arrays):
            result = read_image_member(path, "frames.tiff", number)
            checks.append({"name": "uint16_frame_" + str(number), "pass": result.dtype == expected.dtype and np.array_equal(result, expected)})
        cases = [
            ("negative_frame", {"frame": -1}), ("out_of_range_frame", {"frame": 3}),
            ("bool_frame", {"frame": True}), ("negative_decoded_budget", {"max_frame_bytes": -1}),
            ("small_decoded_budget", {"max_frame_bytes": 1}), ("negative_member_budget", {"maximum_member_bytes": -1}),
            ("small_member_budget", {"maximum_member_bytes": 1}),
        ]
        for name, options in cases:
            rejected = False
            try:
                read_image_member(path, "frames.tiff", **options)
            except ValueError:
                rejected = True
            checks.append({"name": name, "pass": rejected})
        try:
            read_image_member(path, "directory/")
            directory_rejected = False
        except ValueError:
            directory_rejected = True
        checks.append({"name": "directory_rejected", "pass": directory_rejected})
        checks.append({"name": "archive_unchanged", "pass": hashlib.sha256(path.read_bytes()).hexdigest() == original_hash})
    checks.append({"name": "temporary_directory_empty", "pass": not any(temporary_root.iterdir())})
    records = [json.loads(line) for line in (HERE / "MEMBER_PROFILES.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    images = [row for row in records if row["readiness_status"].startswith("READY_NATIVE_IMAGE")]
    result = {"status": "PASS" if all(x["pass"] for x in checks) else "FAIL", "fixture_checks": checks,
              "actual_original_profiles": {"images": len(images), "frames": sum(x["frame_count"] for x in images),
                                           "frames_decoded": sum(len(x["sample_decode_checks"]) for x in images),
                                           "bytes_streamed_and_hashed": sum(x["bytes_streamed"] for x in images)},
              "scope": "Fixtures execute the real numeric reader and input/output budgets. Actual source profiles decode first/middle/last frames and inspect all frame metadata; full-volume scientific validity is not tested."}
    (HERE / "READER_CHECK_RESULTS.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "fixtures": len(checks), "originals": result["actual_original_profiles"]}))


if __name__ == "__main__":
    main()
