import unittest
from publish_shadowrocket import build_profile, caddy_candidate


class PublishShadowrocketTest(unittest.TestCase):
    def test_only_token_specific_site_routes_are_added(self):
        content = ('sub.example.com:8443 {\n\timport /etc/caddy/subscription-accounts.caddy\n\thandle {\n\t\trespond 404\n\t}\n}\n'
                   'sub.example.com {\n\timport /etc/caddy/subscription-accounts.caddy\n\thandle /derp* {\n\t\trespond 200\n\t}\n}\n')
        host, result = caddy_candidate(content, 'test-token')
        self.assertEqual(host, 'sub.example.com')
        self.assertEqual(result.count('/test-token/shadowrocket-rules.conf'), 2)
        self.assertIn('handle /derp*', result)
        self.assertIn('respond 404', result)
        with self.assertRaises(ValueError): caddy_candidate(result, 'test-token')
        with self.assertRaises(ValueError): caddy_candidate(content, '../wrong')

    def test_preserves_user_rules_and_adds_only_own_node_filter(self):
        original = '[General]\nkey = value\n[Proxy Group]\n美国节点 = url-test,policy-regex-filter=US|USA\n[Rule]\nFINAL,PROXY\n'
        expected = original.replace('US|USA\n', 'US|USA|Amadeus-.*-(HY2|Reality|TLS)\n')
        self.assertEqual(build_profile(original.encode()), expected)
        self.assertEqual(build_profile(expected.encode()), expected)
        with self.assertRaises(ValueError): build_profile(b'[Rule]\nFINAL,PROXY\n')


if __name__ == '__main__': unittest.main()
