"""Secret-safe launcher for run-v2-testnet-live.js.

Passwords are obtained through Windows DPAPI and passed only over anonymous
stdin to Node. House is intentionally excluded. Plan/readonly never touches
keystores. This launcher never prints child stderr or secret-bearing errors.
"""
import ctypes
import ctypes.wintypes as wt
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
KEYROOT = Path.home() / 'AppData/Local/hermes/keys/alphaboard-testnet'
WORKER = ROOT / 'scripts/keystore/v2-keystore-worker.js'
ROLES = ('deployer', 'owner', 'treasury', 'resolver', 'testOperator', 'testClient2', 'testClient')

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
    args = sys.argv[1:]
    if '--plan' in args or '--readonly' in args:
        payload = {'mode': 'plan'}
    else:
        if '--execute-arc-testnet-v2' not in args:
            print(json.dumps({'status': 'error', 'errorCode': 'EXECUTION_NOT_ARMED'}))
            return 2
        payload = {'mode': 'execute', 'walletPasswords': {}}
        for role in ROLES:
            raw = unprotect((KEYROOT / f'{role}.password.dpapi').read_bytes())
            try:
                payload['walletPasswords'][role] = raw.decode('latin1')
            finally:
                raw = b''
    node = shutil.which('node')
    if not node:
        print(json.dumps({'status': 'error', 'errorCode': 'NODE_NOT_FOUND'}))
        return 2
    command = [node, str(ROOT / 'scripts/approved-v2-executor.js'), *args]
    child = subprocess.run(command, input=json.dumps(payload), text=True, capture_output=True)
    payload = None
    try:
        result = json.loads(child.stdout)
    except Exception:
        result = {'status': 'error', 'errorCode': 'LIVE_RUN_INVALID_OUTPUT'}
    print(json.dumps(result, separators=(',', ':')))
    return child.returncode

if __name__ == '__main__':
    raise SystemExit(main())
