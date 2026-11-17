import json
import unittest
from tls_node import caddy_candidate, xray_candidate, subscription_candidate, PATH, PORT


class TLSNodeTest(unittest.TestCase):
    def setUp(self):
        self.accounts = [{'account_id': f'user{i}', 'vless_uuid': f'uuid-{i}'} for i in range(6)]
        self.base = {'inbounds': [{'tag': 'vless-reality-in', 'port': 2053, 'settings': {'clients': [
            {'id': a['vless_uuid'], 'email': a['account_id'] + '.vless', 'flow': 'xtls-rprx-vision'} for a in self.accounts]}}]}

    def test_caddy_preserves_existing_routes_and_rejects_collision(self):
        old = 'sub.example.test {\n\timport /etc/caddy/subscription-accounts.caddy\n\thandle {\n\t\trespond 404\n\t}\n}\n'
        host, new = caddy_candidate(old)
        self.assertEqual(host, 'sub.example.test')
        self.assertIn(f'handle {PATH}', new)
        self.assertIn(f'127.0.0.1:{PORT}', new)
        self.assertIn('respond 404', new)
        with self.assertRaises(ValueError): caddy_candidate(new)

    def test_xray_keeps_existing_clients_and_maps_usage_identity(self):
        result = json.loads(xray_candidate(json.dumps(self.base), self.accounts))
        self.assertEqual(result['inbounds'][0], self.base['inbounds'][0])
        incoming = result['inbounds'][1]
        self.assertEqual(incoming['listen'], '127.0.0.1')
        self.assertEqual(incoming['streamSettings']['wsSettings']['path'], PATH)
        self.assertEqual([c['email'] for c in incoming['settings']['clients']], [a['account_id'] + '.vless' for a in self.accounts])
        self.assertTrue(all('flow' not in c for c in incoming['settings']['clients']))
        with self.assertRaises(ValueError): xray_candidate(json.dumps(self.base), self.accounts[:-1])
        with self.assertRaises(ValueError): xray_candidate(json.dumps(result), self.accounts)

    def test_all_formats_preserve_prior_nodes_and_use_same_identity(self):
        a = self.accounts[0]
        for filename in ('clash.yaml', 'shadowrocket.txt', 'qx.conf', 'server.snippet'):
            initial = 'proxies:\n  - name: old\n' if filename == 'clash.yaml' else 'old-node\n'
            result = subscription_candidate(filename, initial, a, 'sub.example.test')
            self.assertTrue(result.startswith(initial))
            self.assertIn(a['vless_uuid'], result)
            self.assertIn('Amadeus-user0-TLS', result)
            with self.assertRaises(ValueError): subscription_candidate(filename, result, a, 'sub.example.test')


if __name__ == '__main__': unittest.main()
