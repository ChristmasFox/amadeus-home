from __future__ import annotations

import json
import threading
import unittest
from http.client import HTTPConnection
from typing import Sequence

from infra.macos.mac_host_agent import MacHostAgentServer, MacHostCollector


class FakeCommands:
    def __init__(self) -> None:
        self.calls: list[tuple[str, ...]] = []

    def __call__(self, args: Sequence[str], _timeout: float) -> tuple[int, str, str]:
        command = tuple(args)
        self.calls.append(command)
        values = {
            ("scutil", "--get", "ComputerName"): (0, "Avalon Mac\n", ""),
            ("sw_vers", "-productVersion"): (0, "15.6\n", ""),
            ("sw_vers", "-buildVersion"): (0, "24G90\n", ""),
            ("sysctl", "-n", "hw.model"): (0, "Macmini9,1\n", ""),
            ("sysctl", "-n", "hw.ncpu"): (0, "8\n", ""),
            ("sysctl", "-n", "hw.memsize"): (0, "17179869184\n", ""),
            ("sysctl", "-n", "kern.boottime"): (0, "{ sec = 1700000000, usec = 0 }\n", ""),
            ("hostname",): (0, "fallback-host\n", ""),
            ("ps", "-A", "-o", "%cpu="): (0, "10.0\n20.0\n", ""),
            ("vm_stat",): (0, "page size of 4096 bytes\nPages free: 100.\nPages inactive: 200.\nPages speculative: 50.\n", ""),
            ("df", "-Pk", "/"): (0, "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk 1000 920 80 92% /\n", ""),
            ("df", "-Pk", "/Volumes/Avalon"): (0, "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/avalon 2000 1000 1000 50% /Volumes/Avalon\n", ""),
            ("netstat", "-ib"): (0, "Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 <Link> xx 1 0 1234 2 0 5678 0\n", ""),
            ("pmset", "-g", "batt"): (0, "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t95%; charging; 0:00 remaining present: true\n", ""),
            ("pgrep", "-x", "cloudflared"): (0, "321\n", ""),
            ("cloudflared", "--version"): (0, "cloudflared version 2026.1\n", ""),
            ("ps", "-Ao", "pid=,pcpu=,pmem=,comm=,args=", "-r"): (0, "321 12.0 1.0 cloudflared cloudflared tunnel run\n", ""),
        }
        return values.get(command, (127, "", "missing fake command"))


class MacHostAgentTest(unittest.TestCase):
    def test_collector_returns_real_host_shape_without_container_fields(self) -> None:
        runner = FakeCommands()
        payload = MacHostCollector(runner=runner).host_status()
        self.assertEqual(payload["status"], "available")
        self.assertEqual(payload["hostname"], "Avalon Mac")
        self.assertEqual(payload["os"], {"name": "macOS", "version": "15.6", "build": "24G90"})
        self.assertEqual(payload["model"], "Macmini9,1")
        self.assertEqual(payload["cpu"]["cores"], 8)
        self.assertEqual(payload["disks"][0]["percentage"], 92.0)
        self.assertEqual(payload["network"][0]["interface"], "en0")
        self.assertEqual(payload["power"]["charging"], True)
        self.assertEqual(payload["cloudflared"]["status"], "running")
        self.assertEqual(payload["highCpuProcesses"][0]["pid"], 321)
        self.assertTrue(all("container" not in key.lower() for key in payload))

    def test_http_surface_requires_token_and_has_no_exec_shell(self) -> None:
        collector = MacHostCollector(runner=FakeCommands())
        server = MacHostAgentServer(("127.0.0.1", 0), "test-token", collector)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]
            for path in ("/v1/health", "/v1/host/status", "/v1/cloudflared/status"):
                connection = HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request("GET", path)
                response = connection.getresponse()
                self.assertEqual(response.status, 401)
                connection.close()

                connection = HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request("GET", path, headers={"Authorization": "Bearer test-token"})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                json.loads(response.read())
                connection.close()

            connection = HTTPConnection("127.0.0.1", port, timeout=3)
            connection.request("GET", "/exec", headers={"Authorization": "Bearer test-token"})
            self.assertEqual(connection.getresponse().status, 404)
            connection.close()

            connection = HTTPConnection("127.0.0.1", port, timeout=3)
            connection.request("POST", "/v1/health", headers={"Authorization": "Bearer test-token"})
            self.assertEqual(connection.getresponse().status, 405)
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
