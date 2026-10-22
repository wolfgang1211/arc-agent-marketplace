"""Fail-closed DPAPI launcher for the single Job5 withdraw attempt.

Default is readonly and never opens a keystore. Armed mode loads only the
existing testClient2 DPAPI password, passes it over child stdin, and never
places it in argv, environment, files, logs, or error text.
"""
import ctypes
import ctypes.wintypes as wt
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
KEYROOT = Path.home() / 'AppData/Local/hermes/keys/alphaboard-testnet'
STATE = Path.home() / 'AppData/Local/hermes/state/alphaboard-v2/job5-withdraw-20261020.json'
NODE_SCRIPT = ROOT / 'scripts/job5-withdraw-once.js'
DPAPI_MODULE = ROOT / 'scripts/run-v2-testnet-live.py'


def _load_unprotect():
    spec = importlib.util.spec_from_file_location('_existing_dpapi_reader', DPAPI_MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.unprotect


def _safe_unprotect(data):
    try:
        return _load_unprotect()(data)
    except Exception as exc:
        raise RuntimeError('DPAPI_UNPROTECT_FAILED') from None


def _safe_result(stdout, code):
    try:
        value = json.loads(stdout)
        if isinstance(value, dict) and 'status' in value:
            return value, code
    except Exception:
        pass
    return {'status': 'error', 'errorCode': 'SAFE_CHILD_FAILURE'}, code or 1


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if any(flag not in ('--execute-job5-withdraw-once',) for flag in args) or args.count('--execute-job5-withdraw-once') > 1:
        return {'status': 'error', 'errorCode': 'UNKNOWN_FLAG'}, 2
    armed = args == ['--execute-job5-withdraw-once']
    node = shutil.which('node')
    if not node:
        return {'status': 'error', 'errorCode': 'NODE_NOT_FOUND'}, 2

    payload = {'mode': 'readonly'}
    password = None
    if armed:
        # Mandatory live attestation/job/nonce preflight happens before DPAPI.
        try:
            preflight = subprocess.run(
                [node, str(NODE_SCRIPT)], input=json.dumps(payload, separators=(',', ':')),
                text=True, capture_output=True, check=False,
            )
            result, code = _safe_result(preflight.stdout, preflight.returncode)
            if code != 0 or result.get('status') != 'readonly-preflight':
                return result, code or 1
        except Exception:
            return {'status': 'error', 'errorCode': 'PREFLIGHT_FAILED'}, 2
        try:
            raw = _safe_unprotect((KEYROOT / 'testClient2.password.dpapi').read_bytes())
            password = raw.decode('latin1')
            raw = b''
        except Exception:
            return {'status': 'error', 'errorCode': 'SECRET_LOAD_FAILED'}, 2
        payload = {'mode': 'execute', 'password': password}

    try:
        child = subprocess.run(
            [node, str(NODE_SCRIPT), *args],
            input=json.dumps(payload, separators=(',', ':')),
            text=True,
            capture_output=True,
            check=False,
        )
        return _safe_result(child.stdout, child.returncode)
    except Exception:
        return {'status': 'error', 'errorCode': 'CHILD_PROCESS_FAILED'}, 2
    finally:
        password = None
        payload = None


if __name__ == '__main__':
    result, code = main()
    print(json.dumps(result, separators=(',', ':')))
    raise SystemExit(code)
