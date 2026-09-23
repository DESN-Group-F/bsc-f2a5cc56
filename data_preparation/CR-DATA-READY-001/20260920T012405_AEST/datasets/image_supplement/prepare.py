"""Resolve suffix-only members to real inert formats or native raster contracts."""
import ast
import hashlib
import io
import json
import pickletools
import sys
import time
import zipfile
from collections import Counter
from pathlib import Path
from PIL import Image, __version__ as pillow_version
from native_image_reader import temporary_member, frame_array, opened_image

HERE = Path(__file__).resolve().parent
RUN = HERE.parent.parent


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [safe(item) for item in value]
    if isinstance(value, bytes):
        return {"bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}
    try:
        return {"numerator": value.numerator, "denominator": value.denominator}
    except AttributeError:
        return str(value)


def static_profile(archive, member):
    with zipfile.ZipFile(archive) as source:
        info = source.getinfo(member)
        if info.is_dir():
            return {"readiness_status": "EXCLUDED_DIRECTORY", "actual_format": "ZIP_DIRECTORY", "evidence_basis": "central_directory_directory_flag"}
        if info.file_size > 16 * 1024**2:
            raise ValueError("static member exceeds bounded 16 MiB read")
        content = source.read(info)
    common = {"bytes_read": len(content), "member_sha256": hashlib.sha256(content).hexdigest()}
    suffix = Path(member).suffix.lower()
    if Path(member).name == ".DS_Store":
        if content[4:8] != b"Bud1":
            raise ValueError("unexpected DS_Store magic")
        return {**common, "readiness_status": "EXCLUDED_FILESYSTEM_METADATA", "actual_format": "MACOS_DS_STORE", "evidence_basis": "Bud1 header", "role": "filesystem_metadata_not_experimental_data"}
    if suffix == ".pth":
        # Inspect archive/pickle syntax only; never unpickle, torch.load, or import.
        names, opcodes = [], 0
        if zipfile.is_zipfile(io.BytesIO(content)):
            with zipfile.ZipFile(io.BytesIO(content)) as checkpoint:
                names = checkpoint.namelist()
                for name in names:
                    if name.endswith(".pkl"):
                        payload = checkpoint.read(name)
                        opcodes += sum(1 for _ in pickletools.genops(payload))
            kind = "PYTORCH_ZIP_CHECKPOINT"
        else:
            opcodes = sum(1 for _ in pickletools.genops(content))
            kind = "PICKLE_BASED_CHECKPOINT"
        return {**common, "readiness_status": "EXCLUDED_MODEL_CHECKPOINT_STATIC_STRUCTURE_CHECKED", "actual_format": kind,
                "archive_entries": names, "pickle_opcode_count_observed": opcodes,
                "role": "author_model_weights_not_background_evidence_or_raw_experiment",
                "limitation": "Not deserialized or numerically prepared. Author model execution/training is outside this preparation scope."}
    text = content.decode("utf-8-sig")
    detail = {"text_lines": len(text.splitlines()), "text_characters": len(text), "encoding": "utf-8-sig"}
    if suffix == ".ipynb":
        notebook = json.loads(text)
        if not isinstance(notebook.get("cells"), list):
            raise ValueError("notebook cell array missing")
        detail.update(nbformat=notebook.get("nbformat"), cells=[{"index": i, "cell_type": cell.get("cell_type"),
                       "source_characters": len("".join(cell.get("source", []))), "outputs_retained_in_original": len(cell.get("outputs", []))}
                      for i, cell in enumerate(notebook["cells"])])
        kind = "JUPYTER_NOTEBOOK_JSON"
    elif suffix == ".py":
        try:
            tree = ast.parse(text)
            detail.update(ast_parse="PASS", top_level_nodes=[type(node).__name__ for node in tree.body])
        except SyntaxError as error:
            detail.update(ast_parse="DIFFERENT_SYNTAX_VERSION_STATIC_TEXT_ONLY", syntax_error_line=error.lineno)
        kind = "PYTHON_SOURCE_TEXT"
    elif suffix == ".m":
        kind = "MATLAB_SOURCE_TEXT"
    elif suffix == ".md":
        kind = "MARKDOWN_TEXT"
    elif Path(member).name == ".gitignore":
        kind = "GIT_IGNORE_TEXT"
    else:
        raise ValueError("unclassified static member")
    return {**common, **detail, "readiness_status": "READY_STATIC_SOURCE_REFERENCE_NO_EXECUTION", "actual_format": kind,
            "role": "author_code_or_documentation_reference", "reader": "ZIP member bytes decoded as UTF-8; notebook cell source or Python AST read inertly",
            "execution": "NEVER_EXECUTED", "limitation": "Static structure/reference access is not validated implementation or model behavior. Apply exact original build-use decision separately."}


def image_profile(archive, member):
    with temporary_member(archive, member) as (path, binding):
        with opened_image(path) as image:
            frames = []
            count = getattr(image, "n_frames", 1)
            for number in range(count):
                image.seek(number)
                tags = getattr(image, "tag_v2", {})
                frames.append({"frame": number, "width": image.width, "height": image.height, "mode": image.mode,
                               "bands": list(image.getbands()), "compression": safe(tags.get(259)),
                               "bits_per_sample": safe(tags.get(258)), "sample_format": safe(tags.get(339)),
                               "x_resolution": safe(tags.get(282)), "y_resolution": safe(tags.get(283)),
                               "resolution_unit_tag": safe(tags.get(296)), "image_description": safe(tags.get(270))})
            samples = []
            for number in sorted({0, count // 2, count - 1}):
                values = frame_array(image, number)
                samples.append({"frame": number, "shape": list(values.shape), "dtype": str(values.dtype),
                                "bytes": values.nbytes, "sha256": hashlib.sha256(values.tobytes()).hexdigest(), "decode_status": "PASS"})
            return {**binding, "readiness_status": "READY_NATIVE_IMAGE_FRAMES_WITH_CALIBRATION_LIMITS", "actual_format": image.format,
                    "frame_count": count, "frames": frames, "sample_decode_checks": samples,
                    "reader_entrypoint": str(HERE / "native_image_reader.py"), "reader_function": "read_image_member",
                    "limits": ["Every IFD/frame metadata entry inspected; only first/middle/last numeric frames decoded for this preparation check.",
                               "Image axes, physical calibration, chemistry and feature interpretation are not inferred. Preserve raw TIFF resolution/description declarations.",
                               "Native reader uses exact ZIP member and frame with byte budgets; source and archive are unchanged."]}


def main():
    targets = rows(HERE / "TARGETS.jsonl")
    sources = {row["file_id"]: row for row in rows(RUN / "SOURCE_OBJECTS.jsonl")}
    seen = set()
    results = []
    output = HERE / "MEMBER_PROFILES.jsonl"
    with output.open("w", encoding="utf-8") as handle:
        for index, target in enumerate(targets):
            key = (target["container_file_id"], target["member_path"])
            if key in seen:
                raise ValueError("target identity duplicate")
            seen.add(key)
            start = time.monotonic()
            item = {"container_file_id": key[0], "member_path": key[1], "original_member_id": target["member_id"],
                    "container_path": sources[key[0]]["input_path"], "source_registered_sha256": sources[key[0]]["registered_sha256"],
                    "source_mutated": False, "source_code_executed": False}
            try:
                if key[1].lower().endswith((".tiff", ".tif", ".png")):
                    item.update(image_profile(item["container_path"], key[1]))
                else:
                    item.update(static_profile(item["container_path"], key[1]))
                item["error"] = None
            except Exception as error:
                item.update(readiness_status="PREPARATION_ERROR", error=type(error).__name__ + ": " + str(error))
            item["elapsed_seconds"] = round(time.monotonic() - start, 3)
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")
            handle.flush()
            results.append(item)
            print(json.dumps({"done": index + 1, "total": len(targets), "file": key[1], "status": item["readiness_status"], "seconds": item["elapsed_seconds"]}), flush=True)
    checks = {"status": "PASS" if all(x["error"] is None for x in results) else "FAIL", "target_count": len(targets), "rows": len(results),
              "status_counts": dict(Counter(x["readiness_status"] for x in results)), "errors": [{"member": x["member_path"], "error": x["error"]} for x in results if x["error"]],
              "pillow_version": pillow_version, "scope": "Exact suffix-only residual set; full inert text structure, model-checkpoint exclusion, filesystem metadata, all raster IFDs and bounded representative frame decoding. No pixel semantics, model execution or full-volume scientific validation."}
    (HERE / "CHECK_RESULTS.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if checks["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
