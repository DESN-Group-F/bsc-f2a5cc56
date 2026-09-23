"""Read a bounded raster frame from an exact ZIP member without executing content.

The whole compressed member is streamed to one temporary file for random TIFF IFD
access, then removed. This is not bulk archive extraction. Frame number does not
imply a time, depth or physical axis. Units/calibration must come from source data.
"""
from contextlib import contextmanager
import hashlib
import tempfile
import zipfile
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
MAX_MEMBER_BYTES = 2 * 1024**3


@contextmanager
def opened_image(path):
    image = Image.open(path)
    try:
        yield image
    finally:
        # Pillow's __exit__ can leave an mmap alive for uncompressed TIFF.
        # close() also releases that mapping before Windows temp-file cleanup.
        image.close()


@contextmanager
def temporary_member(archive, member, maximum_bytes=MAX_MEMBER_BYTES):
    if maximum_bytes <= 0:
        raise ValueError("maximum_bytes must be positive")
    work = HERE / ".tmp"
    work.mkdir(exist_ok=True)
    path = None
    with zipfile.ZipFile(archive) as source:
        info = source.getinfo(member)
        if info.is_dir() or info.file_size > maximum_bytes:
            raise ValueError("member is a directory or exceeds byte budget")
        try:
            digest = hashlib.sha256()
            count = 0
            with tempfile.NamedTemporaryFile(dir=work, suffix=Path(member).suffix, delete=False) as target:
                path = Path(target.name)
                if path.resolve().parent != work.resolve():
                    raise ValueError("unexpected temporary target")
                with source.open(info) as original:
                    while True:
                        chunk = original.read(1024 * 1024)
                        if not chunk:
                            break
                        count += len(chunk)
                        if count > maximum_bytes:
                            raise ValueError("stream exceeds byte budget")
                        digest.update(chunk)
                        target.write(chunk)
            if count != info.file_size:
                raise ValueError("member byte count mismatch")
            yield path, {"bytes_streamed": count, "member_sha256": digest.hexdigest(), "zip_crc32": info.CRC}
        finally:
            if path is not None and path.exists():
                if path.resolve().parent != work.resolve():
                    raise ValueError("refusing cleanup outside temporary directory")
                path.unlink()


def frame_array(image, frame=0, max_frame_bytes=64 * 1024**2):
    if isinstance(frame, bool) or not isinstance(frame, int) or frame < 0:
        raise ValueError("frame must be a nonnegative integer")
    if max_frame_bytes <= 0:
        raise ValueError("max_frame_bytes must be positive")
    if frame >= getattr(image, "n_frames", 1):
        raise ValueError("frame outside declared image")
    image.seek(frame)
    # A conservative 8 bytes/sample covers supported Pillow numeric modes.
    budget = image.width * image.height * len(image.getbands()) * 8
    if budget > max_frame_bytes:
        raise ValueError("decoded frame exceeds conservative byte budget")
    result = np.array(image)
    if result.dtype.hasobject or result.nbytes > max_frame_bytes:
        raise ValueError("unsupported object dtype or frame exceeds byte budget")
    return result


def read_image_member(archive, member, frame=0, max_frame_bytes=64 * 1024**2,
                      maximum_member_bytes=MAX_MEMBER_BYTES):
    """Return a numeric frame; caller supplies exact paths and interpretation."""
    with temporary_member(archive, member, maximum_member_bytes) as (path, _):
        with opened_image(path) as image:
            return frame_array(image, frame, max_frame_bytes)
