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
DISK_ROOT=460GiB|424GiB|36.2GiB|92.1%
DISK_AVALON=7.3TiB|6.7TiB|567GiB|92.4%
NETWORK_INTERFACE=en0
IP_ADDRESS=192.168.1.20
GATEWAY=192.168.1.1
POWER=Now drawing from 'AC Power' -InternalBattery-0 100%; charged; 0:00 remaining present: true
POWER_SOURCE=AC Power
BATTERY_PERCENT=100%
BATTERY_STATE=charged
POWER_REMAINING=0:00
POWER_CONNECTED=true
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
        self.assertIn("⏱️ 运行：3天4小时12分钟", rendered)
        self.assertIn("🔋 电源：交流电源 · 电量 100% · 已充满", rendered)
        self.assertIn("系统盘：已用 424GiB / 460GiB，可用 36.2GiB，使用率 92.1% ⚠️", rendered)
        self.assertIn("Avalon：已用 6.7TiB / 7.3TiB，可用 567GiB，使用率 92.4% ⚠️", rendered)
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
        self.assertIn("⏱️ 运行：未知", rendered)
        self.assertIn("🔋 电源：不可用", rendered)

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
            "🖥️ NAS 状态\n主机：old-mac\n运行时间：2天\n💾 磁盘：/dev/disk3s1 100Gi 60Gi 40Gi 60% /",
        )

    def test_disk_warning_is_only_added_at_ninety_percent(self):
        self.assertNotIn("⚠️", _module._disk_line("100GiB|89GiB|11GiB|89.0%", "系统盘"))
        self.assertIn("⚠️", _module._disk_line("100GiB|90GiB|10GiB|90.0%", "系统盘"))


if __name__ == "__main__":
    unittest.main()
