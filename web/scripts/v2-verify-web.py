"""Serial documented web test command with durable, redacted evidence."""
from pathlib import Path
import glob
import json
import os
import re
import subprocess
import sys
import time

root = Path(__file__).resolve().parent.parent
out = Path(os.environ['V2_LOCAL_UI_STATE'])
assert out.is_dir()
files = sorted(glob.glob('test/*.test.mjs', root_dir=root))
assert files
command = ['node', '--test', '--test-reporter=tap', '--test-concurrency=1', *files]
started = time.monotonic()
print('SERIAL_WEB_TESTS_STARTED', len(files), 'files', flush=True)
env = dict(os.environ)
env['V2_RUN_REAL_PG'] = '0'
env['V2_REAL_PG_APPROVED'] = '0'
env.pop('V2_REAL_PG_DSN', None)
result = subprocess.run(command, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
raw = result.stdout
counts = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', raw, re.M)}
skips = [line for line in raw.splitlines() if '# SKIP' in line]
summary = {'exitCode': result.returncode, 'files': len(files), 'counts': counts, 'realPgSkipped': sum('real-pg' in line.lower() for line in skips), 'otherSkipped': [line for line in skips if 'real-pg' not in line.lower()], 'durationSeconds': round(time.monotonic() - started, 3)}
redacted = re.sub(r'0x[0-9a-fA-F]{64,}', '[REDACTED_HEX]', raw)
redacted = re.sub(r'postgres(?:ql)?://[^\s]+', '[REDACTED_DB_URL]', redacted, flags=re.I)
(out / 'web-full-serial.tap').write_text(redacted, encoding='utf-8')
(out / 'web-full-serial-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps(summary), flush=True)
sys.exit(result.returncode)
