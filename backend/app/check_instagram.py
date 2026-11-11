"""Run interactively inside backend; no credentials in arguments or output."""
import getpass
import hashlib
import hmac
import os
import urllib.request
import urllib.error
import warnings


def main():
    warnings.simplefilter('error', getpass.GetPassWarning)
    configured = os.environ.get('META_APP_SECRET', '')
    print('Container secret configured:', bool(configured))
    print('Container secret length:', len(configured))
    print('Container secret has edge whitespace:', configured != configured.strip())
    candidate = getpass.getpass('Paste App Secret from Meta App settings (hidden): ')
    if not candidate:
        print('No secret entered; stopped.')
        return
    matches = hmac.compare_digest(candidate.encode(), configured.encode())
    print('Matches container secret:', matches)
    if not matches:
        print('Update META_APP_SECRET in .env, recreate backend, then repeat.')
        return
    # Empty entries: authenticate through the local proxy without creating leads.
    raw = b'{"object":"instagram","entry":[]}'
    signature = 'sha256=' + hmac.new(candidate.encode(), raw, hashlib.sha256).hexdigest()
    for label, sig in [('signed', signature), ('unsigned', '')]:
        request = urllib.request.Request(
            'http://webhook/api/webhooks/instagram', data=raw,
            headers={'Content-Type': 'application/json', 'X-Hub-Signature-256': sig})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                code = response.status
        except urllib.error.HTTPError as exc:
            code = exc.code
        except urllib.error.URLError:
            print(label, 'connection failed; check webhook/backend services')
            continue
        expected = 200 if sig else 403
        print(label, 'HTTP', code, 'PASS' if code == expected else 'FAIL')


if __name__ == '__main__':
    main()
