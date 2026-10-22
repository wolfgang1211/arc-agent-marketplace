import { getAddress, isAddress } from 'viem';

const UINT256_MAX = (1n << 256n) - 1n;
const FIXED_CHAIN_ID = 5042002n;
const FIXED_MARKETPLACE = '0xfa156b7a5205b123c8a22a807ba98405e36130f1';
const STATUS = Object.freeze({ Open: 0, InProgress: 1, Submitted: 2, RevisionPending: 3, AccessRecovery: 4, Disputed: 5, Completed: 6, Refunded: 7, Cancelled: 8 });
const TERMINAL = new Set(['Completed', 'Refunded', 'Cancelled', 6, 7, 8]);
const privateKeys = ['pitch', 'signature'];
function fail() { return false; }
function wallet(value) { if (typeof value !== 'string' || !isAddress(value)) return null; try { return getAddress(value).toLowerCase(); } catch { return null; } }
function id(value) { if (typeof value !== 'string' && typeof value !== 'bigint') return null; try { const n = BigInt(value); return n >= 0n && n <= UINT256_MAX ? n.toString() : null; } catch { return null; } }
function plainJob(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const names = ['chainId', 'marketplace', 'jobId', 'client', 'operator', 'resolver', 'status']; const copy = Object.create(null);
  for (const name of names) { const descriptor = Object.getOwnPropertyDescriptor(raw, name); if (descriptor && !('value' in descriptor)) return null; if (descriptor) copy[name] = descriptor.value; }
  const chainId = typeof copy.chainId === 'bigint' ? id(copy.chainId) : null; const marketplace = wallet(copy.marketplace); const jobId = id(copy.jobId); const client = wallet(copy.client); if (!chainId || !marketplace || !jobId || !client) return null;
  const operator = copy.operator == null ? null : wallet(copy.operator); const resolver = copy.resolver == null ? null : wallet(copy.resolver); if (copy.operator != null && !operator || copy.resolver != null && !resolver) return null;
  const status = typeof copy.status === 'string' ? copy.status : Number.isInteger(copy.status) ? copy.status : null; if (status === null) return null;
  return Object.freeze({ chainId, marketplace, jobId, client, operator, resolver, status });
}
function binding(job, expectedChain, expectedMarket) { const fresh = plainJob(job); return fresh && fresh.chainId === id(expectedChain) && fresh.marketplace === wallet(expectedMarket) ? fresh : null; }
function isParty(session, job) { const w = wallet(session); return Boolean(w && (w === job.client || w === job.operator || w === job.resolver)); }
function role(job, session) { const w = wallet(session); if (!w) return null; if (w === job.client) return 'client'; if (w === job.operator) return 'operator'; if (w === job.resolver) return 'resolver'; return null; }

export function createJobAcl({ chainId, marketplace } = {}) {
  const expectedChain = typeof chainId === 'bigint' && chainId === FIXED_CHAIN_ID ? chainId.toString() : null; const expectedMarket = wallet(marketplace); if (expectedChain === null || expectedMarket !== FIXED_MARKETPLACE) throw new TypeError('fixed job binding is required');
  const fresh = (job) => binding(job, expectedChain, expectedMarket);
  const canReadApplications = (sessionWallet, job, applicationOperator = undefined) => { const j = fresh(job); if (!j) return false; const r = role(j, sessionWallet); if (r === 'client' || r === 'resolver') return true; if (r !== 'operator' || applicationOperator === undefined) return false; return wallet(applicationOperator) === wallet(sessionWallet); };
  const canReadDeliveries = (sessionWallet, job) => { const j = fresh(job); return Boolean(j && isParty(sessionWallet, j)); };
  const canSubmitDelivery = (sessionWallet, job) => { const j = fresh(job); const w = wallet(sessionWallet); if (!j || !w || w !== j.operator) return false; return j.status === 'InProgress' || j.status === STATUS.InProgress; };
  const canSubmitRevision = (sessionWallet, job) => { const j = fresh(job); const w = wallet(sessionWallet); if (!j || !w || w !== j.operator) return false; return j.status === 'RevisionPending' || j.status === STATUS.RevisionPending; };
  return Object.freeze({ canReadApplications, canReadDeliveries, canSubmitDelivery, canSubmitRevision, sanitizeJob: fresh, isTerminal: (job) => { const j = fresh(job); return Boolean(j && TERMINAL.has(j.status)); } });
}

export { plainJob, STATUS };
