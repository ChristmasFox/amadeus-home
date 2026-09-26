import importlib.util
from pathlib import Path
p=Path(__file__).with_name('align-qwen-b-reference.py')
spec=importlib.util.spec_from_file_location('b_alignment',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Item:
 def __init__(self,text,end_time):self.text=text;self.end_time=end_time
lines=['こんにちは','世界です','またね']
items=[Item('こん',.3),Item('にちは',1.2),Item('世界',1.7),Item('です',2.1),Item('またね',3.0)]
assert m.line_end_time(lines,items,2)==(2.1,True)
assert m.normalized('日本語。\n')==m.normalized('日本語')
try:m.line_end_time(lines,items[:-1],2)
except ValueError as exc:assert str(exc)=='aligner_text_coverage_mismatch'
else:raise AssertionError('missing forced alignment coverage gate')
print('B_ALIGNMENT_OFFLINE_FIXTURE=passed')
