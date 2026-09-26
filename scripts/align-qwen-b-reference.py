#!/usr/bin/env python3
"""Local-only word/character alignment of the protected A transcript to inspect B cut."""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import time
import unicodedata

MODEL_ID = 'mlx-community/Qwen3-ForcedAligner-0.6B-8bit'
MODEL_REV = '0e1a68e91d815300c7c9754b2a7639378b23db15'
REPO = Path(__file__).resolve().parents[1]


def private(path: Path, directory: bool = False) -> None:
    if path.is_symlink() or not (path.is_dir() if directory else path.is_file()) or path.stat().st_mode & 0o077:
        raise ValueError('protected_alignment_input_required')


def normalized(text: str) -> str:
    return ''.join(char for char in unicodedata.normalize('NFKC', text).lower()
                   if not unicodedata.category(char).startswith(('P','Z','C')))


def line_end_time(lines: list[str], items: list, last_line: int) -> tuple[float, bool]:
    if not 1 <= last_line <= len(lines):
        raise ValueError('invalid_line_boundary')
    target_chars = len(normalized('\n'.join(lines[:last_line])))
    full = normalized('\n'.join(lines))
    aligned = ''.join(normalized(item.text) for item in items)
    if not full or not aligned or full != aligned:
        raise ValueError('aligner_text_coverage_mismatch')
    cursor = 0
    for item in items:
        cursor += len(normalized(item.text))
        if cursor >= target_chars:
            return float(item.end_time), cursor == target_chars
    raise ValueError('line_boundary_not_aligned')


def memory_gate() -> int:
    output = subprocess.check_output(['memory_pressure','-Q'],text=True)
    match = re.search(r'System-wide memory free percentage:\s*(\d+)%',output)
    if not match or int(match.group(1)) < 40:raise RuntimeError('insufficient_memory_headroom_for_alignment')
    return int(match.group(1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--prepare-apply',action='store_true')
    mode.add_argument('--apply',action='store_true')
    parser.add_argument('--model-root',type=Path,required=True)
    parser.add_argument('--source-profile',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--line-end',type=int,default=5)
    parser.add_argument('--candidate-cut-seconds',type=float,default=15.4)
    args=parser.parse_args()
    if not args.prepare_apply and not args.apply:
        print(f'B_ALIGNMENT=plan_only model={MODEL_ID}@{MODEL_REV}; private text/audio remain local')
        return
    if (not args.model_root.is_absolute() or args.model_root == REPO or REPO in args.model_root.parents
            or not args.output.is_absolute() or args.output == REPO or REPO in args.output.parents):
        raise ValueError('external_absolute_paths_required')
    private(args.source_profile,directory=True)
    for name in ('reference.wav','reference.txt'):private(args.source_profile/name)
    free=memory_gate()
    model_dir=args.model_root/'model'
    if args.prepare_apply:
        os.umask(0o077)
        args.model_root.mkdir(parents=True,exist_ok=True,mode=0o700)
        private(args.model_root,directory=True)
        cache=args.model_root/'cache';cache.mkdir(mode=0o700,exist_ok=True)
        private(cache,directory=True)
        os.environ['HF_HOME']=str(cache)
        from huggingface_hub import snapshot_download
        snapshot_download(MODEL_ID,revision=MODEL_REV,local_dir=model_dir)
        private(model_dir,directory=True)
        print(f'B_LOCAL_ALIGNER_MODEL=ready free_percent_before={free} (public weights outside Git)')
        return
    private(args.model_root,directory=True)
    private(model_dir,directory=True)
    if not (model_dir/'config.json').is_file():raise ValueError('local_aligner_model_missing')
    private(args.output.parent,directory=True)
    if args.output.exists():raise ValueError('alignment_output_already_exists')
    os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
    lines=(args.source_profile/'reference.txt').read_text(encoding='utf-8').strip().splitlines()
    transcript='\n'.join(lines)
    from mlx_audio.stt import load
    import soundfile as sf
    start=time.monotonic()
    try:
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            model=load(str(model_dir))
            result=model.generate(str(args.source_profile/'reference.wav'),text=transcript,language='Japanese')
    except Exception as exc:
        raise SystemExit('local_alignment_failed category='+type(exc).__name__) from None
    end_s,exact=line_end_time(lines,list(result.items),args.line_end)
    summary={'model_id':MODEL_ID,'model_revision':MODEL_REV,'profile_id':args.source_profile.name,
             'audio_duration_ms':round(sf.info(args.source_profile/'reference.wav').duration*1000),
             'line_end':args.line_end,'aligned_line_end_seconds':round(end_s,3),
             'exact_token_boundary':exact,'candidate_cut_seconds':args.candidate_cut_seconds,
             'difference_seconds':round(args.candidate_cut_seconds-end_s,3),
             'aligned_items':len(result.items),'audit_wall_ms':round((time.monotonic()-start)*1000),
             'memory_free_percent_before':free,
             'interpretation':'forced alignment is approximate; owner/ASR quality remains separate'}
    os.umask(0o077)
    fd=os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as stream:json.dump(summary,stream,indent=2,sort_keys=True);stream.write('\n')
    print('B_ALIGNMENT=completed private_content_suppressed')
    print('LINE_END_S=%.3f CUT_S=%.3f DELTA_S=%.3f EXACT_TOKEN=%s'%(end_s,args.candidate_cut_seconds,summary['difference_seconds'],exact))

if __name__=='__main__':main()
