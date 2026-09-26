import importlib.util
from pathlib import Path
import sys

p=Path(__file__).with_name('audit-qwen-b-reference.py')
spec=importlib.util.spec_from_file_location('b_ref_audit',p)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
assert module.normalized(' 日本語。\n') == module.normalized('日本語')
assert module.normalized('ＡＢＣ') == 'abc'
assert module.MODEL_REV and len(module.MODEL_REV)==40
assert module.PROFILE_IDS == ('A','B','C','D','E')
print('B_REFERENCE_OFFLINE_AUDIT_FIXTURE=passed')
