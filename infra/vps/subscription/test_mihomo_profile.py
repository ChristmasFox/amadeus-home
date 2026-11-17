import unittest
from pathlib import Path
from mihomo_profile import render


class FullProfileTest(unittest.TestCase):
    def setUp(self):
        self.nodes = ('proxies:\n  - name: "Amadeus-demo-HY2"\n    type: hysteria2\n'
                      '  - name: "Amadeus-demo-Reality"\n    type: vless\n'
                      '  - name: "Amadeus-demo-TLS"\n    type: vless\n')
        self.template = Path(__file__).with_name('mihomo-policy.yaml').read_text()

    def test_preserves_nodes_and_replaces_policy_idempotently(self):
        first = render(self.nodes, self.template, 'https://example.test/geosite.dat')
        self.assertTrue(first.startswith(self.nodes.rstrip()))
        self.assertEqual(render(first, self.template, 'https://example.test/geosite.dat'), first)
        for node in ('Amadeus-demo-HY2', 'Amadeus-demo-Reality', 'Amadeus-demo-TLS'):
            self.assertEqual(first.count(node), 2)
        self.assertIn('GEOSITE,youtube,YouTube', first)
        self.assertIn('MATCH,其他外网', first)
        self.assertIn('GEOSITE,cn,DIRECT', first)
        self.assertNotIn('type: direct', first)
        self.assertNotIn('__HY2__', first)

    def test_rejects_missing_or_existing_unmanaged_policy(self):
        with self.assertRaises(ValueError): render(self.nodes.replace('-TLS', '-other'), self.template, 'https://example.test/geosite.dat')
        with self.assertRaises(ValueError): render(self.nodes + 'rules:\n- MATCH,DIRECT\n', self.template, 'https://example.test/geosite.dat')
        with self.assertRaises(ValueError): render(self.nodes + '# BEGIN AMADEUS MIHOMO POLICY v1\n', self.template, 'https://example.test/geosite.dat')


if __name__ == '__main__': unittest.main()
