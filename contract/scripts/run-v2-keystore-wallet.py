"""Offline CurrentUser-DPAPI keystore bridge. No secret uses argv, env or stdout."""
import ctypes
import ctypes.wintypes as wt
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path.home() / 'AppData/Local/hermes/keys/alphaboard-testnet'
WORKER = Path(__file__).resolve().parent / 'keystore/v2-keystore-worker.js'
ROLES = {'deployer', 'owner', 'treasury', 'resolver', 'testOperator', 'testClient2', 'testClient'}

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
    if len(sys.argv) != 2 or sys.argv[1] not in ROLES:
        print(json.dumps({'ok': False, 'error': 'INVALID_ROLE'}))
        return 2
    role = sys.argv[1]
    try:
        password = unprotect((ROOT / f'{role}.password.dpapi').read_bytes())
        payload = json.dumps({'op': 'decrypt', 'role': role, 'password': password.decode('latin1')})
        password = b''
        # Anonymous stdin pipe only; child stdout is restricted to public metadata.
        child = subprocess.run(['node', str(WORKER)], input=payload, text=True, capture_output=True)
        payload = ''
        if child.returncode != 0:
            raise RuntimeError('KEYSTORE_LOAD_FAILED')
        result = json.loads(child.stdout)
        expected = json.loads((ROOT / 'roles-manifest.json').read_text())['roles'][role]['address']
        if result.get('ok') is not True or result.get('address', '').lower() != expected.lower():
            raise RuntimeError('ADDRESS_MISMATCH')
        print(json.dumps({'ok': True, 'role': role, 'address': result['address'], 'mode': 'offline-address-check'}))
        return 0
    except Exception:
        # Never surface library exception payloads or secret input.
        print(json.dumps({'ok': False, 'error': 'KEYSTORE_LOAD_FAILED'}))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
