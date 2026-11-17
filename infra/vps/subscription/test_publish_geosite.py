import unittest
from publish_geosite import caddy_candidate


class PublishGeoSiteTest(unittest.TestCase):
    def test_exact_token_route_and_idempotency(self):
        caddy = ('sub.example.com:8443 {\n\timport /etc/caddy/subscription-accounts.caddy\n\thandle {\n\t\trespond 404\n\t}\n}\n'
                 'sub.example.com {\n\timport /etc/caddy/subscription-accounts.caddy\n\thandle /existing {\n\t\trespond 200\n\t}\n}\n')
        host, output = caddy_candidate(caddy, 'token-test')
        self.assertEqual(host, 'sub.example.com')
        self.assertEqual(output.count('/token-test/geosite.dat'), 2)
        self.assertIn('handle /existing', output)
        self.assertEqual(caddy_candidate(output, 'token-test'), (host, output))
        with self.assertRaises(ValueError): caddy_candidate(output, 'other-token')
        with self.assertRaises(ValueError): caddy_candidate(caddy, '../invalid')


if __name__ == '__main__': unittest.main()
