import json
import re
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
VALUES = {
    "START_BLOCK": "0",
    "ARC_TESTNET_RPC_URL": "https://rpc.testnet.arc.network",
    "CONTRACT_ADDRESS": "0x0000000000000000000000000000000000000001",
}

text = (ROOT / "config.yaml").read_text(encoding="utf-8")
text = re.sub(r"\$\{([A-Z0-9_]+)\}", lambda match: VALUES[match.group(1)], text)
config = yaml.safe_load(text)
schema = json.loads((ROOT / "node_modules" / "envio" / "evm.schema.json").read_text(encoding="utf-8"))
errors = sorted(Draft202012Validator(schema).iter_errors(config), key=lambda error: list(error.path))
if errors:
    raise SystemExit("\n".join(f"{list(error.path)}: {error.message}" for error in errors))
print("config.yaml validates against envio 3.6.1 evm.schema.json")
