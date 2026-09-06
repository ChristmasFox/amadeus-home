import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "components" / "tools" / "nas_status.py"
_spec = importlib.util.spec_from_file_location("macos_nas_status", MODULE_PATH)
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"unable to load {MODULE_PATH}")
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)


class NasStatusFormatterTests(unittest.TestCase):
    def test_v2_payload_renders_mobile_system_card(self):
        raw = """NAS_STATUS_VERSION=2
HOST=avalon-mini
OS_NAME=macOS
OS_VERSION=15.6.1
OS_BUILD=24G90
MODEL=Macmini9,1
CPU_PHYSICAL=8
CPU_LOGICAL=8
MEM_TOTAL_BYTES=17179869184
MEM_FREE_PERCENT=25
LOAD_AVERAGE=1.20 0.90 0.70
UPTIME=up 3 days, 4:12
USER_COUNT=1
DISK_ROOT=460Gi|16Gi|37Gi|31%
DISK_AVALON=7.3Ti|6.7Ti|567Gi|93%
NETWORK_INTERFACE=en0
IP_ADDRESS=192.168.1.20
GATEWAY=192.168.1.1
POWER=AC Power
CLOUDFLARED=未运行
TOP_PROCESS=123|python3|30.1|4.2
"""

        rendered = _module.format_nas_status(raw)

        self.assertIn("🖥️ NAS 系统状态", rendered)
        self.assertIn("✅ 主机：avalon-mini", rendered)
        self.assertIn("🧩 系统：macOS v15.6.1 (24G90)", rendered)
        self.assertIn("💻 型号：Macmini9,1", rendered)
        self.assertIn("⚙️ CPU：8 逻辑核", rendered)
        self.assertIn("🧠 内存：16.0 GiB，总计；已用 75% / 可用 25%", rendered)
        self.assertIn("系统盘：16Gi / 460Gi，可用 37Gi，已用 31%", rendered)
        self.assertIn("Avalon：6.7Ti / 7.3Ti，可用 567Gi，已用 93% ⚠️", rendered)
        self.assertIn("🌐 网络：en0 · 192.168.1.20 · 网关 192.168.1.1", rendered)
        self.assertIn("python3 · CPU 30.1% · 内存 4.2%", rendered)
        self.assertNotIn("DISK_ROOT=", rendered)

    def test_missing_fields_are_explicitly_unavailable(self):
        rendered = _module.format_nas_status(
            """NAS_STATUS_VERSION=2
HOST=test-mac
OS_NAME=macOS
DISK_ROOT=unavailable
DISK_AVALON=
"""
        )

        self.assertIn("✅ 主机：test-mac", rendered)
        self.assertIn("🧠 内存：不可用", rendered)
        self.assertIn("系统盘：不可用", rendered)
        self.assertIn("Avalon：不可用", rendered)
        self.assertIn("🌐 网络：不可用", rendered)

    def test_legacy_payload_remains_compatible(self):
        rendered = _module.format_nas_status(
            """host=old-mac
uptime=up 2 days
disk:
/dev/disk3s1  100Gi  60Gi  40Gi  60% /
"""
        )

        self.assertEqual(
            rendered,
            "🖥️ NAS 状态\n主机：old-mac\n运行时间：up 2 days\n💾 磁盘：/dev/disk3s1 100Gi 60Gi 40Gi 60% /",
        )

    def test_disk_warning_is_only_added_at_ninety_percent(self):
        self.assertNotIn("⚠️", _module._disk_line("100Gi|89Gi|11Gi|89%", "系统盘"))
        self.assertIn("⚠️", _module._disk_line("100Gi|90Gi|10Gi|90%", "系统盘"))


if __name__ == "__main__":
    unittest.main()
