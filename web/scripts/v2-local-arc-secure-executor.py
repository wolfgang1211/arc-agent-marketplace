"""DPAPI launcher for the isolated Arc counterparty worker.

Only --plan and --status are non-signing. Execution is explicit, role-scoped,
and sends the DPAPI plaintext only through anonymous stdin to Node. Secrets are
never placed in argv, environment, stdout, or stderr.
"""
import ctypes
import ctypes.wintypes as wt
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent.parent
KEYROOT = Path.home() / 'AppData/Local/hermes/keys/alphaboard-testnet'
WORKER = ROOT / 'web/scripts/v2-local-arc-secure-executor-worker.mjs'
ROLES = ('testOperator', 'owner')
class BLOB(ctypes.Structure):
    _fields_ = [('cbData', wt.DWORD), ('pbData', ctypes.POINTER(ctypes.c_byte))]
def unprotect(data):
    crypt32 = ctypes.WinDLL('crypt32', use_last_error=True); kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt32.CryptUnprotectData.argtypes = [ctypes.POINTER(BLOB), ctypes.POINTER(wt.LPWSTR), ctypes.POINTER(BLOB), wt.LPVOID, wt.LPVOID, wt.DWORD, ctypes.POINTER(BLOB)]; crypt32.CryptUnprotectData.restype = wt.BOOL
    kernel32.LocalFree.argtypes = [wt.HLOCAL]; kernel32.LocalFree.restype = wt.HLOCAL
    buf = (ctypes.c_byte * len(data)).from_buffer_copy(data); source = BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte))); result, description = BLOB(), wt.LPWSTR()
    if not crypt32.CryptUnprotectData(ctypes.byref(source), ctypes.byref(description), None, None, None, 1, ctypes.byref(result)): raise RuntimeError('DPAPI_UNPROTECT_FAILED')
    try: return ctypes.string_at(result.pbData, result.cbData)
    finally:
        if description: kernel32.LocalFree(description)
        ctypes.memset(result.pbData, 0, result.cbData); kernel32.LocalFree(result.pbData)
def status():
    manifest = ROOT / 'contract/docs/v2-testnet-wallets.json'
    try: roles = json.loads(manifest.read_text(encoding='utf8')).get('roles', {})
    except Exception: roles = {}
    return {'status': 'blocked', 'executionAccepted': False, 'blocker': 'LIVE_EXECUTION_NOT_ACCEPTED', 'keystorePaths': {r: (KEYROOT / f'{r}.keystore').is_file() for r in ROLES}, 'passwordPaths': {r: (KEYROOT / f'{r}.password.dpapi').is_file() for r in ROLES}, 'publicRoles': {r: roles.get(r) for r in ROLES}}
def main():
    args = sys.argv[1:]
    if '--status' in args or '--plan' in args or '--readonly' in args:
        print(json.dumps(status(), separators=(',', ':'))); return 0
    # Fail before DPAPI, keystore access or any wallet operation until the
    # real API payloads, fee/nonce population and canonical readbacks pass review.
    print(json.dumps({'status': 'blocked', 'errorCode': 'LIVE_EXECUTION_NOT_ACCEPTED'})); return 2
    if '--execute-arc-testnet-v2' not in args: print(json.dumps({'status': 'error', 'errorCode': 'EXECUTION_NOT_ARMED'})); return 2
    role = next((args[i + 1] for i, v in enumerate(args[:-1]) if v == '--role'), None)
    if role not in ROLES: print(json.dumps({'status': 'error', 'errorCode': 'ROLE_REQUIRED'})); return 2
    node = shutil.which('node')
    if not node: print(json.dumps({'status': 'error', 'errorCode': 'NODE_NOT_FOUND'})); return 2
    raw = unprotect((KEYROOT / f'{role}.password.dpapi').read_bytes())
    try:
        # The job payload is supplied by the caller on stdin only; never accept a secret there.
        payload = json.loads(sys.stdin.read() or '{}'); payload.update({'op': 'execute', 'role': role, 'password': raw.decode('latin1')})
        child = subprocess.run([node, str(WORKER)], input=json.dumps(payload), text=True, capture_output=True)
    finally:
        raw = b''; payload = None
    try: result = json.loads(child.stdout)
    except Exception: result = {'status': 'error', 'errorCode': 'SECURE_WORKER_INVALID_OUTPUT'}
    print(json.dumps(result, separators=(',', ':'))); return child.returncode
if __name__ == '__main__': raise SystemExit(main())
