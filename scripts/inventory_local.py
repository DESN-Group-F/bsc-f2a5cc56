#!/usr/bin/env python3
"""Read-only metadata inventory for ONE explicitly selected source root.
No document parsing, network calls, archive extraction or RAG ingestion.
Output must be outside the source root and must not already exist.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import sys
from datetime import datetime, timezone
from typing import Any

EXCLUDED_DIRS = {
    '.git', '.venv', 'venv', 'node_modules', '__pycache__',
    'evals', 'evaluation', 'benchmarks', 'private_expected', 'checkpoints',
    'qwen original physics and chem ability test',
}
HASH_EXTENSIONS = {'.pdf','.docx','.md','.txt','.html','.htm','.csv','.json','.jsonl','.xlsx','.png','.jpg','.jpeg','.webp'}
REPARSE_POINT = 0x400

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

def linked(path: Path, info: os.stat_result | None = None) -> bool:
    info = info if info is not None else path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, 'st_file_attributes', 0) & REPARSE_POINT)

def within(child: Path, root: Path) -> bool:
    try:
        child.relative_to(root)
        return True
    except ValueError:
        return False

def collect(root_path: Path, *, hash_max_bytes: int = 0, max_files: int = 20000) -> dict[str, Any]:
    if hash_max_bytes < 0 or max_files < 1:
        raise ValueError('hash limit must be nonnegative; max_files must be positive')
    root_path = root_path.expanduser().absolute()
    if linked(root_path):
        raise ValueError('source root must not be a symbolic link or reparse point')
    root = root_path.resolve(strict=True)
    if not root.is_dir():
        raise ValueError('source root must be a directory')
    records: list[dict[str, Any]] = []
    excluded: list[dict[str, str]] = []
    errors: list[dict[str, str]] = []
    pending = [root]
    truncated = False
    start = utc_now()
    while pending and not truncated:
        directory = pending.pop()
        try:
            with os.scandir(directory) as scan:
                entries = sorted(scan, key=lambda entry: entry.name.casefold())
        except OSError as exc:
            errors.append({'relative_path':str(directory.relative_to(root)), 'error':type(exc).__name__})
            continue
        for entry in entries:
            path = Path(entry.path)
            rel = path.relative_to(root).as_posix()
            try:
                info = entry.stat(follow_symlinks=False)
                if linked(path, info):
                    excluded.append({'relative_path':rel,'reason':'SYMLINK_OR_REPARSE_POINT'})
                    continue
                if stat.S_ISDIR(info.st_mode):
                    if entry.name.casefold() in EXCLUDED_DIRS or entry.name.startswith('.'):
                        excluded.append({'relative_path':rel,'reason':'EXCLUDED_DIRECTORY'})
                    else:
                        pending.append(path)
                    continue
                if not stat.S_ISREG(info.st_mode):
                    excluded.append({'relative_path':rel,'reason':'NOT_REGULAR_FILE'})
                    continue
                if entry.name.startswith('.') or path.suffix.casefold() in {'.pem','.key','.pfx','.p12'}:
                    excluded.append({'relative_path':rel,'reason':'HIDDEN_OR_SECRET_FILE'})
                    continue
                if len(records) >= max_files:
                    truncated = True
                    break
                row: dict[str, Any] = {
                    'relative_path':rel, 'suffix':path.suffix.casefold(),
                    'size_bytes':info.st_size, 'mtime_ns':info.st_mtime_ns,
                    'sha256':None, 'hash_status':'NOT_REQUESTED',
                    'content_parsed':False, 'ai_use_permission':'UNKNOWN',
                    'document_role':'UNCLASSIFIED', 'indexed':False,
                }
                if hash_max_bytes:
                    if path.suffix.casefold() not in HASH_EXTENSIONS:
                        row['hash_status']='SKIPPED_TYPE'
                    elif info.st_size > hash_max_bytes:
                        row['hash_status']='SKIPPED_SIZE'
                    else:
                        # Re-check before opening; no symlink traversal is intentional.
                        before = path.lstat()
                        if linked(path, before) or not within(path.resolve(strict=True), root):
                            row['hash_status']='REFUSED_PATH_CHANGE'
                        else:
                            h=hashlib.sha256()
                            with path.open('rb') as stream:
                                opened=os.fstat(stream.fileno())
                                total=0
                                while block:=stream.read(min(1024*1024,hash_max_bytes-total+1)):
                                    total+=len(block)
                                    if total > hash_max_bytes:
                                        break
                                    h.update(block)
                                after=os.fstat(stream.fileno())
                            if total>hash_max_bytes:
                                row['hash_status']='CHANGED_OR_EXCEEDED_LIMIT'
                            elif (opened.st_size,opened.st_mtime_ns)!=(after.st_size,after.st_mtime_ns) or total!=opened.st_size or (before.st_size,before.st_mtime_ns)!=(opened.st_size,opened.st_mtime_ns):
                                row['hash_status']='CHANGED_DURING_READ'
                            else:
                                row['sha256']=h.hexdigest();row['hash_status']='HASHED'
                records.append(row)
            except OSError as exc:
                errors.append({'relative_path':rel,'error':type(exc).__name__})
    return {
        'schema_version':'0.3', 'inventory_type':'READ_ONLY_METADATA_NOT_RAG',
        'requested_root':str(root_path), 'resolved_root':str(root),
        'started_at':start, 'finished_at':utc_now(),
        'hash_max_bytes':hash_max_bytes, 'max_files':max_files,
        'truncated':truncated, 'records':sorted(records,key=lambda r:r['relative_path']),
        'excluded':excluded,'errors':errors,
        'status':'PARTIAL' if truncated or errors else 'COMPLETED',
        'warning':'A file being present does not establish permission, applicability, indexing or model competence. This is not a hostile-filesystem sandbox; source files should not be concurrently modified.',
    }

def save_report(report: dict[str, Any], destination: Path) -> None:
    root=Path(report['resolved_root']).resolve()
    destination=destination.expanduser().absolute().resolve(strict=False)
    if within(destination,root):
        raise ValueError('output must be outside the source root')
    if destination.exists():
        raise FileExistsError(f'refusing to overwrite {destination}')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with destination.open('x',encoding='utf-8') as stream:
        json.dump(report,stream,ensure_ascii=False,indent=2)
        stream.write('\n')

def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--hash-max-mib',type=float,default=0.0)
    parser.add_argument('--max-files',type=int,default=20000)
    args=parser.parse_args()
    if not math.isfinite(args.hash_max_mib) or args.hash_max_mib<0:
        parser.error('--hash-max-mib must be finite and nonnegative')
    try:
        # Validate destination before scanning/hash work.
        root=args.root.expanduser().absolute().resolve(strict=True)
        out=args.out.expanduser().absolute().resolve(strict=False)
        if within(out,root): raise ValueError('output must be outside source root')
        if out.exists(): raise FileExistsError('report already exists; choose a new filename')
        report=collect(args.root,hash_max_bytes=int(args.hash_max_mib*1024*1024),max_files=args.max_files)
        save_report(report,args.out)
        print(json.dumps({'status':report['status'],'files':len(report['records']),'errors':len(report['errors']),'truncated':report['truncated'],'report':str(args.out)},ensure_ascii=False))
        return 0 if report['status']=='COMPLETED' else 2
    except (OSError,ValueError) as exc:
        print(f'ERROR: {exc}',file=sys.stderr)
        return 1

if __name__=='__main__':raise SystemExit(main())
