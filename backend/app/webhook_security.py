"""Verify the exact wire bytes; never log keys, bodies or signatures."""
import hashlib
import hmac
import re


def signature_status(raw: bytes, signature: str, secret: str) -> str:
    if not secret:
        return 'unconfigured'
    if not signature:
        return 'missing'
    if not re.fullmatch(r'sha256=[0-9a-fA-F]{64}', signature):
        return 'malformed'
    expected = hmac.new(secret.encode('utf-8'), raw, hashlib.sha256).digest()
    return 'valid' if hmac.compare_digest(bytes.fromhex(signature[7:]), expected) else 'mismatch'
