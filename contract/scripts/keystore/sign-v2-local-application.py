"""Local-only EIP-712 signer. Public typed data arrives on stdin; secrets stay in memory."""
import ctypes
import ctypes.wintypes as wt
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path.home() / 'AppData/Local/hermes/keys/alphaboard-testnet'
WORKER = Path(__file__).resolve().parent / 'sign-v2-local-application.js'
ROLE = 'testOperator'

class BLOB(ctypes.Structure):
    _fields_ = [('cbData', wt.DWORD), ('pbData', ctypes.POINTER(ctypes.c_byte))]

def unprotect(data):
    crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt32.CryptUnprotectData.argtypes = [ctypes.POINTER(BLOB), ctypes.POINTER(wt.LPWSTR), ctypes.POINTER(BLOB), wt.LPVOID, wt.LPVOID, wt.DWORD, ctypes.POINTER(BLOB)]
    crypt32.CryptUnprotectData.restype = wt.BOOL
    kernel32.LocalFree.argtypes = [wt.HLOCAL]
    kernel32.LocalFree.restype = wt.HLOCAL
    buf = (ctypes.c_byte * len(data)).from_buffer_copy(data)
    source = BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))
    result, description = BLOB(), wt.LPWSTR()
    if not crypt32.CryptUnprotectData(ctypes.byref(source), ctypes.byref(description), None, None, None, 1, ctypes.byref(result)):
        raise RuntimeError('DPAPI_UNPROTECT_FAILED')
    try:
        return ctypes.string_at(result.pbData, result.cbData)
    finally:
        if description:
            kernel32.LocalFree(description)
        ctypes.memset(result.pbData, 0, result.cbData)
        kernel32.LocalFree(result.pbData)

def main():
    request = json.load(sys.stdin)
    if request.get('role') != ROLE or str(request.get('chainId')) != '31337':
        print(json.dumps({'ok': False, 'error': 'LOCAL_CHAIN_OR_ROLE_REJECTED'})); return 2
    manifest = json.loads((ROOT / 'roles-manifest.json').read_text())
    expected = manifest['roles'][ROLE]['address']
    if request.get('expectedAddress', '').lower() != expected.lower():
        print(json.dumps({'ok': False, 'error': 'ADDRESS_MISMATCH'})); return 2
    password = unprotect((ROOT / f'{ROLE}.password.dpapi').read_bytes())
    child_input = json.dumps({**request, 'op': 'signLocalApplication', 'password': password.decode('latin1')})
    password = b''
    try:
        child = subprocess.run(['node', str(WORKER)], input=child_input, text=True, capture_output=True)
        child_input = ''
        result = json.loads(child.stdout)
        if child.returncode != 0 or result.get('ok') is not True or not isinstance(result.get('signature'), str):
            raise RuntimeError('LOCAL_SIGN_FAILED')
        print(result['signature'])
        return 0
    except Exception:
        print(json.dumps({'ok': False, 'error': 'LOCAL_SIGN_FAILED'})); return 1

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({'ok': False, 'error': 'LOCAL_SIGN_FAILED'})); raise SystemExit(1)
