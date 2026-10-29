import { resolveV2ChainProfile, assertV2ProfileEnvironment } from '../chain-profile.mjs';

export async function loadV2ChainProfile({ env = process.env, manifestPath } = {}) {
  if (env?.V2_CHAIN_PROFILE !== 'local-hardhat') return resolveV2ChainProfile({ env });
  // Run the deployment guard before opening even a public fixture file.
  assertV2ProfileEnvironment(env);
  const { readFile } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const { homedir } = await import('node:os');
  const location = manifestPath ?? path.join(env.V2_LOCAL_UI_STATE ?? path.join(homedir(), 'AppData', 'Local', 'hermes', 'cache', 'scratch', 'v2-local-ui-state'), 'manifest.json');
  const manifest = JSON.parse(await readFile(location, 'utf8'));
  return resolveV2ChainProfile({ env, localManifest: manifest });
}
export async function resolveV2ServerChainProfile({ env = process.env, localManifest } = {}) {
  return localManifest ? resolveV2ChainProfile({ env, localManifest }) : loadV2ChainProfile({ env });
}
