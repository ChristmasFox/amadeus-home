import re
import unittest
from pathlib import Path


PATCH_PATH = Path(__file__).parents[1] / "patch_telegram_adapter.py"


def load_injected_filter():
    source = PATCH_PATH.read_text(encoding="utf-8")
    match = re.search(r"think_block = r\"\"\"(.*?)\"\"\"", source, re.DOTALL)
    if match is None:
        raise AssertionError("Telegram think filter source block is missing")
    namespace = {"re": re}
    exec(match.group(1), namespace)
    return namespace["_strip_telegram_think_markup"]


class TelegramThinkFilterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.strip = staticmethod(load_injected_filter())

    def test_removes_complete_think_block_and_preserves_answer(self):
        self.assertEqual(
            self.strip("前置\n<think>内部推理</think>\n最终答案"),
            "前置\n\n最终答案",
        )

    def test_removes_unclosed_streaming_think_block(self):
        self.assertEqual(self.strip("<think>尚未结束的推理"), "")
        self.assertEqual(self.strip("最终答案</think>"), "最终答案")

    def test_is_case_insensitive_and_leaves_normal_text_untouched(self):
        self.assertEqual(self.strip("<THINK>reason</THINK>答案"), "答案")
        self.assertEqual(self.strip("普通文本"), "普通文本")
        self.assertEqual(self.strip(None), None)

    def test_patch_contains_outbound_and_streaming_guards(self):
        source = PATCH_PATH.read_text(encoding="utf-8")
        self.assertIn("_sanitize_telegram_outbound_kwargs(kwargs)", source)
        self.assertIn("_strip_telegram_think_markup(components[0]['text'])", source)
        self.assertIn("_strip_telegram_think_markup(text_component.get('text', ''))", Path(
            Path(__file__).parents[1] / "patch_pubg_telegram_picker.py"
        ).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
