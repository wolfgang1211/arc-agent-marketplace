"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useChainId,
  useSwitchChain,
  useReadContract,
  useWriteContract,
  useConfig,
} from "wagmi";
import { getBlock, readContract, waitForTransactionReceipt } from "wagmi/actions";
import { formatUnits, parseUnits } from "viem";
import { BrandLogo } from "./brand-logo";
import { arcTestnet, USDC_ADDRESS, USDC_DECIMALS, EXPLORER, FAUCET } from "../lib/chain";
import {
  CONTRACT_ADDRESS,
  MARKETPLACE_ABI,
  ERC20_ABI,
  JOB_STATUS,
} from "../lib/contract";
import {
  fetchDiscovery,
  filterAndSortOpenJobs,
  loadOnchainAgentFallback,
} from "../lib/discovery.mjs";
import {
  MarketplaceDataState,
  resolveCollectionStatus,
} from "../lib/marketplace-data-state.mjs";
import {
  buildUrlSummaryDescription,
  URL_SUMMARY_CATEGORY,
  URL_SUMMARY_LANGUAGES,
  URL_SUMMARY_MAX_WORDS,
  URL_SUMMARY_MIN_WORDS,
  validateUrlSummaryReward,
  validateUrlSummaryRequest,
} from "../lib/url-summary-job.mjs";
import {
  assertSuccessfulReceipt,
  formatDuration,
  formatUsdcAmount,
  getJobStatusCounts,
  getPaginationState,
  getTimeoutState,
  PERMISSIONLESS_SETTLEMENT_COPY,
  revalidateTimeoutClaim,
  splitDisputedReward,
  terminalOutcomeCopy,
  timeoutOutcomeCopy,
} from "../lib/timeout-recovery.mjs";

const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const fmt = (v) => (v == null ? "0" : formatUnits(v, USDC_DECIMALS));
const SECTION_SPLIT = "\n\nAcceptance criteria:\n";
const DISCOVERY_ENDPOINT = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL || "";
const JOB_PAGE_SIZE = 20n;
const parseJobDetails = (description = "") => {
  const [task, criteria] = String(description).split(SECTION_SPLIT);
  return { task: task || description, criteria: criteria || "" };
};

export default function Page() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null); // {type, text}
  const [categoryFilter, setCategoryFilter] = useState("");
  const [rewardMin, setRewardMin] = useState("");
  const [rewardMax, setRewardMax] = useState("");
  const [jobSort, setJobSort] = useState("newest");
  const [indexedDiscovery, setIndexedDiscovery] = useState(null);
  const [onchainAgents, setOnchainAgents] = useState([]);
  const [onchainAgentsLoading, setOnchainAgentsLoading] = useState(false);
  const [onchainAgentsError, setOnchainAgentsError] = useState("");
  const [onchainAgentsResolved, setOnchainAgentsResolved] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [pageOffset, setPageOffset] = useState(0n);
  const [chainTimestamp, setChainTimestamp] = useState(null);
  const discoveryRequestId = useRef(0);

  const wrongNetwork = isConnected && chainId !== arcTestnet.id;
  const noContract = !CONTRACT_ADDRESS;

  const { data: jobsPage, error: jobsReadError, refetch: refetchJobs } = useReadContract({
    address: CONTRACT_ADDRESS || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "getJobsPaged",
    args: [pageOffset, JOB_PAGE_SIZE],
    query: { enabled: !!CONTRACT_ADDRESS, refetchInterval: 8000 },
  });
  const jobs = useMemo(() => jobsPage?.[0] || [], [jobsPage]);
  const totalJobs = jobsPage?.[1] || 0n;
  const jobsStatus = resolveCollectionStatus({
    hasResponse: jobsPage !== undefined,
    error: noContract ? new Error("Contract address is missing") : jobsReadError,
    itemCount: jobs.length,
  });

  useEffect(() => {
    if (!CONTRACT_ADDRESS) return undefined;
    let mounted = true;
    const syncChainTime = async () => {
      try {
        const block = await getBlock(config, { chainId: arcTestnet.id, blockTag: "latest" });
        if (mounted) setChainTimestamp(block.timestamp);
      } catch {
        if (mounted) setChainTimestamp(null);
      }
    };
    syncChainTime();
    const interval = setInterval(syncChainTime, 8000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [config]);

  const { data: agent, refetch: refetchAgent } = useReadContract({
    address: CONTRACT_ADDRESS || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "getAgent",
    args: [address],
    query: { enabled: !!CONTRACT_ADDRESS && !!address },
  });

  const { data: usdcBalance, refetch: refetchBal } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });

  const { data: disputeTimeout, refetch: refetchDisputeTimeout } = useReadContract({
    address: CONTRACT_ADDRESS || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "DISPUTE_TIMEOUT",
    query: { enabled: !!CONTRACT_ADDRESS },
  });

  const { data: agentStake } = useReadContract({
    address: CONTRACT_ADDRESS || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "AGENT_STAKE",
    query: { enabled: !!CONTRACT_ADDRESS },
  });

  const discoveryFilters = useMemo(() => ({
    category: categoryFilter,
    rewardMin: parseRewardFilter(rewardMin),
    rewardMax: parseRewardFilter(rewardMax),
    sort: jobSort,
    first: 100,
  }), [categoryFilter, rewardMin, rewardMax, jobSort]);

  useEffect(() => {
    if (!DISCOVERY_ENDPOINT) return undefined;
    const requestId = ++discoveryRequestId.current;
    const controller = new AbortController();
    setDiscoveryLoading(true);
    setDiscoveryError("");
    fetchDiscovery(DISCOVERY_ENDPOINT, discoveryFilters, (url, options) => fetch(url, { ...options, signal: controller.signal }))
      .then((result) => {
        if (requestId === discoveryRequestId.current) setIndexedDiscovery(result);
      })
      .catch((error) => {
        if (requestId !== discoveryRequestId.current || error.name === "AbortError") return;
        setDiscoveryError(error.message);
      })
      .finally(() => {
        if (requestId === discoveryRequestId.current && !controller.signal.aborted) setDiscoveryLoading(false);
      });
    return () => controller.abort();
  }, [discoveryFilters]);

  useEffect(() => {
    if (!CONTRACT_ADDRESS || jobsStatus === "loading" || jobsStatus === "error") {
      setOnchainAgents([]);
      setOnchainAgentsResolved(false);
      return undefined;
    }
    if (jobs.length === 0) {
      setOnchainAgents([]);
      setOnchainAgentsResolved(true);
      return undefined;
    }
    let mounted = true;
    setOnchainAgentsResolved(false);
    setOnchainAgentsLoading(true);
    setOnchainAgentsError("");
    loadOnchainAgentFallback(
      jobs,
      (who) => readContract(config, {
        address: CONTRACT_ADDRESS,
        abi: MARKETPLACE_ABI,
        functionName: "getAgent",
        args: [who],
        chainId: arcTestnet.id,
      }),
      (who) => readContract(config, {
        address: CONTRACT_ADDRESS,
        abi: MARKETPLACE_ABI,
        functionName: "getAgentReputation",
        args: [who],
        chainId: arcTestnet.id,
      }),
    )
      .then((result) => { if (mounted) setOnchainAgents(result); })
      .catch((error) => { if (mounted) setOnchainAgentsError(error.message); })
      .finally(() => {
        if (mounted) {
          setOnchainAgentsLoading(false);
          setOnchainAgentsResolved(true);
        }
      });
    return () => { mounted = false; };
  }, [config, jobs, jobsStatus]);

  const refreshAll = async () => {
    const refreshes = [refetchJobs(), refetchAgent(), refetchBal(), refetchDisputeTimeout()];
    if (CONTRACT_ADDRESS) {
      refreshes.push(
        getBlock(config, { chainId: arcTestnet.id, blockTag: "latest" })
          .then((block) => setChainTimestamp(block.timestamp))
          .catch(() => setChainTimestamp(null))
      );
    }
    if (DISCOVERY_ENDPOINT) {
      const requestId = ++discoveryRequestId.current;
      setDiscoveryLoading(true);
      refreshes.push(fetchDiscovery(DISCOVERY_ENDPOINT, discoveryFilters)
        .then((result) => {
          if (requestId !== discoveryRequestId.current) return;
          setIndexedDiscovery(result);
          setDiscoveryError("");
        })
        .catch((error) => {
          if (requestId === discoveryRequestId.current) setDiscoveryError(error.message);
        })
        .finally(() => {
          if (requestId === discoveryRequestId.current) setDiscoveryLoading(false);
        }));
    }
    await Promise.allSettled(refreshes);
  };
  const openOnPage = filterAndSortOpenJobs(jobs, discoveryFilters);
  const lifecycleJobs = jobs.filter((job) => Number(job.status) !== 0);
  const jobList = [...lifecycleJobs, ...openOnPage].sort((a, b) => Number(b.id - a.id));
  const pagination = getPaginationState(pageOffset, JOB_PAGE_SIZE, totalJobs);
  const statusCounts = getJobStatusCounts(jobList);
  const indexedAgents = indexedDiscovery?.agents || [];
  const recommendedAgents = indexedAgents.length > 0 ? indexedAgents : onchainAgents;
  const recommendationResolved = onchainAgentsResolved
    && (!DISCOVERY_ENDPOINT || indexedDiscovery !== null || Boolean(discoveryError));
  const recommendationError = recommendedAgents.length === 0
    ? (jobsStatus === "error" ? jobsReadError || new Error("Job data unavailable") : discoveryError || onchainAgentsError)
    : null;
  const recommendationStatus = resolveCollectionStatus({
    hasResponse: recommendationResolved && !discoveryLoading && !onchainAgentsLoading,
    error: recommendationError,
    itemCount: recommendedAgents.length,
  });
  const metricValue = (value) => jobsStatus === "loading" ? "…" : jobsStatus === "error" ? "—" : value;
  const requestConnect = () => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  };

  async function run(label, fn) {
    setMsg(null);
    setBusy(label);
    try {
      const hash = await fn();
      if (hash) {
        const receipt = await waitForTransactionReceipt(config, { hash });
        assertSuccessfulReceipt(receipt);
        setMsg({
          type: "ok",
          text: "Transaction confirmed.",
          link: `${EXPLORER}/tx/${hash}`,
        });
      }
      await refreshAll();
    } catch (e) {
      setMsg({ type: "err", text: humanError(e) });
      await refreshAll();
    } finally {
      setBusy("");
    }
  }

  const write = (functionName, args) =>
    writeContractAsync({ address: CONTRACT_ADDRESS, abi: MARKETPLACE_ABI, functionName, args });

  const readTimeoutSnapshot = async (jobId) => {
    const block = await getBlock(config, { chainId: arcTestnet.id, blockTag: "latest" });
    const result = await readContract(config, {
      address: CONTRACT_ADDRESS,
      abi: MARKETPLACE_ABI,
      functionName: "getJobsPaged",
      args: [BigInt(jobId) - 1n, 1n],
      blockNumber: block.number,
      chainId: arcTestnet.id,
    });
    return { job: result?.[0]?.[0], chainTimestamp: block.timestamp };
  };

  return (
    <Shell
      right={isConnected ? (
        <ConnectedWallet address={address} onDisconnect={() => disconnect()} />
      ) : (
        <WalletConnect connectors={connectors} connecting={connecting} onConnect={connect} />
      )}
    >
      {noContract && (
        <div className="banner err">
          Contract address is missing. Add <span className="mono">NEXT_PUBLIC_CONTRACT_ADDRESS</span> to <b>web/.env.local</b> and restart the server.
        </div>
      )}

      {wrongNetwork && (
        <div className="banner warn flex-between">
          <span>You are on the wrong network. Switch to Arc Testnet to continue.</span>
          <button onClick={() => switchChain({ chainId: arcTestnet.id })}>Switch to Arc Testnet</button>
        </div>
      )}

      {msg && (
        <div className={`banner ${msg.type}`} role={msg.type === "err" ? "alert" : "status"} aria-live="polite">
          {msg.text}{" "}
          {msg.link && <a href={msg.link} target="_blank" rel="noreferrer">View on Explorer →</a>}
        </div>
      )}

      {!isConnected && (
        <div className="banner info flex-between">
          <span>Read-only mode. Live jobs, agents, reputation, and deadlines are available without a wallet.</span>
          <button onClick={requestConnect} disabled={connecting || connectors.length === 0}>
            {connecting ? "Connecting…" : "Connect wallet to transact"}
          </button>
        </div>
      )}

      <div className="network-strip" aria-label="Network details">
        <span><b>Arc Testnet</b> · Chain 5042002</span>
        <span>Escrow <a className="mono" href={`${EXPLORER}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" aria-label="View escrow contract on explorer">{short(CONTRACT_ADDRESS)} ↗</a></span>
        <span className="testnet-copy">Test tokens have no real-world value</span>
      </div>

      <section className="dashboard-grid">
        <div className="card balance-card metric-card metric-card-large">
          <div className="metric-label">Wallet balance</div>
          <div className="balance-value">{isConnected ? `${fmt(usdcBalance)} USDC` : "Wallet not connected"}</div>
          <p className="muted">{isConnected ? "Test USDC available for escrow deposits and rewards." : "Connect only when you want to register, fund, or settle a job."}</p>
          <a className="button-link ghost" href={FAUCET} target="_blank" rel="noreferrer">Get test USDC ↗</a>
        </div>
        <MetricCard label="Open jobs" value={metricValue(statusCounts.open)} tone="blue" />
        <MetricCard label="In progress" value={metricValue(statusCounts.active)} tone="yellow" />
        <MetricCard label="Settled records" value={metricValue(statusCounts.settled)} tone="green" />
      </section>

      <p className="network-note">
        Arc gas uses <b>native USDC</b> with 18 decimals. Escrow uses <b>ERC-20 USDC</b> with 6 decimals.
      </p>

      <section className="action-grid" id="actions" aria-label="Marketplace actions">
        <RegisterAgent agent={agent} stake={agentStake} busy={busy} connected={isConnected} onConnect={requestConnect}
          disabled={wrongNetwork || noContract || agentStake == null}
          onWithdraw={() => run("withdraw", () => write("withdrawStake", []))}
          onRegister={(name, skill, fee) =>
            run("register", async () => {
              if (!agent?.registered) {
                const approveHash = await writeContractAsync({
                  address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve",
                  args: [CONTRACT_ADDRESS, agentStake],
                });
                assertSuccessfulReceipt(await waitForTransactionReceipt(config, { hash: approveHash }));
              }
              return write("registerAgent", [name, skill, fee ? parseUnits(fee, USDC_DECIMALS) : 0n]);
            })
          } />

        <PostJob busy={busy} disabled={wrongNetwork || noContract} connected={isConnected} onConnect={requestConnect}
          onPost={async (desc, reward, category) => {
            await run("post", async () => {
              const amount = parseUnits(reward, USDC_DECIMALS);
              const approveHash = await writeContractAsync({
                address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve",
                args: [CONTRACT_ADDRESS, amount],
              });
              assertSuccessfulReceipt(await waitForTransactionReceipt(config, { hash: approveHash }));
              return write("postJob", [desc, amount, category]);
            });
          }} />
      </section>

      <section className="card jobs-panel" id="jobs">
        <div className="section-head">
          <div>
            <div className="eyebrow small-eyebrow">Marketplace</div>
            <h2>Jobs and settlements</h2>
            <p className="muted">Open work, active delivery windows, and final outcomes from the latest on-chain records.</p>
          </div>
          <button className="ghost" onClick={refreshAll}>Refresh</button>
        </div>

        <div className="discovery-toolbar" aria-label="Open job discovery filters">
          <div className="field">
            <label htmlFor="job-category-filter">Category</label>
            <input id="job-category-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} placeholder="All categories" />
          </div>
          <div className="field">
            <label htmlFor="job-reward-min">Minimum reward</label>
            <input id="job-reward-min" inputMode="decimal" value={rewardMin} onChange={(event) => setRewardMin(event.target.value)} placeholder="5 USDC" />
          </div>
          <div className="field">
            <label htmlFor="job-reward-max">Maximum reward</label>
            <input id="job-reward-max" inputMode="decimal" value={rewardMax} onChange={(event) => setRewardMax(event.target.value)} placeholder="No maximum" />
          </div>
          <div className="field">
            <label htmlFor="job-sort">Sort open jobs</label>
            <select id="job-sort" value={jobSort} onChange={(event) => setJobSort(event.target.value)}>
              <option value="newest">Newest first</option>
              <option value="rewardDesc">Highest reward</option>
              <option value="rewardAsc">Lowest reward</option>
            </select>
          </div>
        </div>
        <div className="discovery-summary">
          <span>
            {jobsStatus === "loading"
              ? "Loading bounded on-chain jobs…"
              : jobsStatus === "error"
                ? "On-chain job data unavailable"
                : `${totalJobs.toString()} total on-chain jobs · showing ${pagination.start.toString()}–${pagination.end.toString()}`}
          </span>
          <span>{discoveryLoading ? "Updating agent data…" : "Latest on-chain records"}</span>
        </div>
        {discoveryError && <div className="banner warn">Indexer unavailable: {discoveryError}. Showing the last indexed result.</div>}

        {jobsStatus !== "ready" ? (
          <MarketplaceDataState resource="jobs" status={jobsStatus} />
        ) : (
          <div className="jobs-list">
            {jobList.map((j) => (
              <JobCard key={j.id.toString()} job={j} me={address} agent={agent} busy={busy}
                agentStake={agentStake}
                connected={isConnected}
                onConnect={requestConnect}
                disabled={wrongNetwork || noContract}
                chainTimestamp={chainTimestamp}
                disputeTimeout={disputeTimeout}
                onAccept={() => run("accept" + j.id, () => write("acceptJob", [j.id]))}
                onSubmit={(uri) => run("submit" + j.id, () => write("submitDeliverable", [j.id, uri]))}
                onApprove={() => run("approve" + j.id, () => write("approveAndPay", [j.id]))}
                onDispute={() => run("dispute" + j.id, () => write("disputeJob", [j.id]))}
                onClaim={() => run("claim" + j.id, async () => {
                  await revalidateTimeoutClaim(j.id, () => readTimeoutSnapshot(j.id));
                  return write("claimTimeout", [j.id]);
                })}
                onCancel={() => run("cancel" + j.id, () => write("cancelJob", [j.id]))}
              />
            ))}
          </div>
        )}
        {(jobsStatus === "ready" || jobsStatus === "empty") && (
          <div className="pagination" aria-label="Job pages">
            <button className="ghost" disabled={!pagination.hasPrevious} onClick={() => setPageOffset(pagination.previousOffset)}>Previous</button>
            <span>Jobs {pagination.start.toString()}–{pagination.end.toString()} of {totalJobs.toString()}</span>
            <button className="ghost" disabled={!pagination.hasNext} onClick={() => setPageOffset(pagination.nextOffset)}>Next</button>
          </div>
        )}
      </section>

      <RankedAgents agents={recommendedAgents} status={recommendationStatus} source={indexedAgents.length > 0 ? "marketplace index" : "latest on-chain records"} />
    </Shell>
  );
}

function RankedAgents({ agents, status, source }) {
  return (
    <section className="card ranked-agents-panel" id="agents">
      <div className="section-head">
        <div>
          <div className="eyebrow small-eyebrow">Reputation</div>
          <h2>Recommended agents</h2>
          <p className="muted">Ranked by distinct approved clients since the latest slash, then approved deliveries. Source: {source}.</p>
        </div>
      </div>
      {status !== "ready" ? (
        <MarketplaceDataState resource="agents" status={status} />
      ) : (
        <div className="ranked-agent-list">
          {agents.map((rankedAgent, index) => (
            <a className="ranked-agent" href={`/agents/${rankedAgent.address}`} key={rankedAgent.address}>
              <span className="ranked-agent-position">#{index + 1}</span>
              <span className="ranked-agent-copy">
                <strong>{rankedAgent.name || short(rankedAgent.address)}</strong>
                <small>{rankedAgent.skill || "No skill summary"}</small>
              </span>
              <span className="ranked-agent-metric">
                <strong>{String(rankedAgent.currentDistinctClients ?? 0)}</strong>
                <small>distinct clients</small>
              </span>
              <span className="ranked-agent-metric">
                <strong>{String(rankedAgent.currentApprovedDeliveries ?? 0)}</strong>
                <small>approved deliveries</small>
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function MetricCard({ label, value, tone }) {
  return (
    <div className={`card metric-card ${tone ? `metric-${tone}` : ""}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function Shell({ children, right }) {
  return (
    <main className="container">
      <header className="header">
        <div className="brand-lockup">
          <a className="brand" href="/" aria-label="AlphaBoard Agents home"><BrandLogo /></a>
          <span className="environment-badge">Testnet</span>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <a href="#jobs">Jobs</a>
          <a href="#agents">Agents</a>
          <a href="#actions">Post or register</a>
        </nav>
        <div className="header-wallet">{right}</div>
      </header>
      <section className="product-intro" aria-labelledby="marketplace-title">
        <div>
          <p className="eyebrow">Escrow-backed work on Arc</p>
          <h1 id="marketplace-title">Hire agents. Verify outcomes.</h1>
          <p>Browse public jobs, fund work in test USDC, and follow every settlement directly on-chain.</p>
        </div>
        <a className="button-link primary" href="#actions">Post a job</a>
      </section>
      {children}
    </main>
  );
}

function WalletConnect({ connectors, connecting, onConnect }) {
  const connector = connectors[0];
  return (
    <button className="ghost" onClick={() => connector && onConnect({ connector })} disabled={!connector || connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

function ConnectedWallet({ address, onDisconnect }) {
  return (
    <div className="connected-wallet">
      <div className="status-dot" />
      <div>
        <div className="wallet-label">Connected</div>
        <div className="wallet-address">{short(address)}</div>
      </div>
      <button className="ghost small" onClick={onDisconnect}>Disconnect</button>
    </div>
  );
}

function RegisterAgent({ agent, stake, onRegister, onWithdraw, onConnect, connected, busy, disabled }) {
  const [name, setName] = useState("");
  const [skill, setSkill] = useState("");
  const [proof, setProof] = useState("");
  const [fee, setFee] = useState("");
  const registered = agent && agent.registered;
  const profile = proof ? `${skill}\nAI agent verification: ${proof}` : skill;
  return (
    <div className="card action-card">
      <div className="eyebrow small-eyebrow">For operators</div>
      <h2>Register an agent {registered && <span className="pill done">Registered: {agent.name}</span>}</h2>
      <div className="row">
        <div className="field"><label htmlFor="agent-name">Agent name</label><input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aria" /></div>
        <div className="field"><label htmlFor="agent-skills">Skills</label><input id="agent-skills" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="Summaries, translation, research" /></div>
        <div className="field"><label htmlFor="agent-fee">Suggested fee (USDC)</label><input id="agent-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="50" /></div>
      </div>
      <div className="field">
        <label htmlFor="agent-proof">Profile evidence</label>
        <input id="agent-proof" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Workflow, demo, portfolio, or operating rules" />
      </div>
      <div className="info-box compact">
        <b>Registration stake:</b> {stake == null ? "Loading from contract…" : `${fmt(stake)} USDC`}. Describe how your AI agent works and what evidence clients can review.
      </div>
      <button disabled={connected && (disabled || busy === "register" || !name)} onClick={() => connected ? onRegister(name, profile, fee) : onConnect()}>
        {!connected ? "Connect wallet to register as an agent" : busy === "register" ? "Registering…" : registered ? "Update profile" : "Register agent"}
      </button>
      {(!connected || registered) && (
        <button className="ghost" disabled={connected && (disabled || busy === "withdraw")} onClick={() => connected ? onWithdraw() : onConnect()}>
          {!connected ? "Connect wallet to withdraw stake" : busy === "withdraw" ? "Withdrawing…" : "Withdraw stake"}
        </button>
      )}
    </div>
  );
}

function PostJob({ onPost, onConnect, connected, busy, disabled }) {
  const [desc, setDesc] = useState("");
  const [criteria, setCriteria] = useState("");
  const [reward, setReward] = useState("");
  const [categoryMode, setCategoryMode] = useState(URL_SUMMARY_CATEGORY);
  const [customCategory, setCustomCategory] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [summaryLanguage, setSummaryLanguage] = useState("en");
  const [maxWords, setMaxWords] = useState("400");
  const isUrlSummary = categoryMode === URL_SUMMARY_CATEGORY;
  const category = categoryMode === "custom" ? customCategory.trim() : categoryMode;
  const combinedDescription = criteria ? `${desc}${SECTION_SPLIT}${criteria}` : desc;
  const summaryValidation = validateUrlSummaryRequest({
    sourceUrl,
    language: summaryLanguage,
    maxWords,
  });
  const summaryRewardValid = validateUrlSummaryReward(reward);
  const canPost = isUrlSummary
    ? summaryValidation.valid && summaryRewardValid
    : Boolean(desc && reward && category);
  const postDescription = isUrlSummary
    ? () => buildUrlSummaryDescription({ sourceUrl, language: summaryLanguage, maxWords })
    : () => combinedDescription;
  return (
    <div className="card action-card">
      <div className="eyebrow small-eyebrow">For clients</div>
      <h2>Post a job with escrow</h2>
      <details className="info-box guidance">
        <summary>What makes a good job post?</summary>
        <ul>
          <li>Describe the expected output and format.</li>
          <li>Add links, files, context, or source material.</li>
          <li>Define clear acceptance criteria before locking funds.</li>
          <li>Set a reward that matches complexity and urgency.</li>
        </ul>
      </details>
      <div className="field">
        <label id="job-category-label">Category</label>
        <div className="job-type-picker" role="group" aria-labelledby="job-category-label">
          <button type="button" className={isUrlSummary ? "selected" : "ghost"} aria-pressed={isUrlSummary} onClick={() => setCategoryMode(URL_SUMMARY_CATEGORY)}>URL summary</button>
          <button type="button" className={categoryMode === "custom" ? "selected" : "ghost"} aria-pressed={categoryMode === "custom"} onClick={() => setCategoryMode("custom")}>Other job</button>
        </div>
        {categoryMode === "custom" && (
          <p className="other-job-warning">No registered agent currently accepts this job type, so it may remain open.</p>
        )}
      </div>
      {isUrlSummary ? (
        <div className="url-summary-fields">
          <div className="info-box compact">
            <b>No JSON required.</b> Enter the source and preferences below. The marketplace creates the bot&apos;s strict request automatically.
          </div>
          <div className="field">
            <label htmlFor="summary-source-url">Source URL</label>
            <input id="summary-source-url" type="url" inputMode="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://example.com/article" autoComplete="url" />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="summary-language">Summary language</label>
              <select id="summary-language" value={summaryLanguage} onChange={(e) => setSummaryLanguage(e.target.value)}>
                {URL_SUMMARY_LANGUAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="summary-max-words">Maximum words</label>
              <input id="summary-max-words" type="number" min={URL_SUMMARY_MIN_WORDS} max={URL_SUMMARY_MAX_WORDS} step="1" value={maxWords} onChange={(e) => setMaxWords(e.target.value)} />
            </div>
          </div>
          <div className="acceptance-note">
            <b>Fixed acceptance criteria</b>
            <span>The delivery must be an accessible IPFS page with the source URL and hash, title, summary, key points, limitations, and machine-readable result.json.</span>
          </div>
          {sourceUrl && !summaryValidation.valid && <div className="form-error" role="alert">{summaryValidation.error}</div>}
        </div>
      ) : (
        <>
          <div className="field"><label htmlFor="job-description">Job description</label><textarea id="job-description" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Summarize this PDF into 10 bullet points. Include key risks, numbers, and a final recommendation." /></div>
          <div className="field"><label htmlFor="job-criteria">Acceptance criteria</label><textarea id="job-criteria" rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="Delivery is accepted if it includes: summary, key takeaways, risks, source references, and an accessible final link." /></div>
          {categoryMode === "custom" && <div className="field"><label htmlFor="job-custom-category">Custom category</label><input id="job-custom-category" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="research" /></div>}
        </>
      )}
      <div className="field"><label htmlFor="job-reward">Reward (test USDC)</label><input id="job-reward" inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)} placeholder={isUrlSummary ? "5" : "100"} /></div>
      {isUrlSummary && reward && !summaryRewardValid && <div className="form-error" role="alert">URL summary rewards must be between 5 and 20 USDC.</div>}
      {isUrlSummary && <p className="bot-decline-note">The bot may decline the job after checking the source; an unaccepted job remains open, and the job owner can cancel it to reclaim the escrowed reward.</p>}
      <button disabled={disabled || busy === "post" || !canPost} onClick={() => connected ? onPost(postDescription(), reward, category) : onConnect()}>
        {!connected ? "Connect wallet to post a job" : busy === "post" ? "Approving, then posting…" : "Lock USDC and publish job"}
      </button>
      <p className="muted" style={{ marginTop: 8 }}>Two signatures are required: first USDC <b>approve</b>, then <b>postJob</b>.</p>
    </div>
  );
}

function JobCard({ job, me, agent, agentStake, onAccept, onSubmit, onApprove, onDispute, onClaim, onCancel, onConnect, connected, busy, disabled, chainTimestamp, disputeTimeout }) {
  const [uri, setUri] = useState("");
  const [confirmingDispute, setConfirmingDispute] = useState(false);
  const disputeTriggerRef = useRef(null);
  const disputeDialogRef = useRef(null);
  useEffect(() => {
    if (!confirmingDispute) return undefined;
    const dialog = disputeDialogRef.current;
    const trigger = disputeTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.querySelector("[data-modal-initial]")?.focus();

    const handleDialogKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmingDispute(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex='-1'])")];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKey);
    return () => {
      window.removeEventListener("keydown", handleDialogKey);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [confirmingDispute]);
  const status = Number(job.status);
  const isClient = me && me.toLowerCase() === job.client.toLowerCase();
  const isAgent = me && me.toLowerCase() === job.agent.toLowerCase();
  const registered = agent && agent.registered;
  const pillClass = ["open", "progress", "submitted", "disputed", "done", "cancel", "expired-refund", "expired-payout", "expired-split"][status];
  const timeoutRole = isClient ? "client" : isAgent ? "agent" : "observer";
  const role = isClient ? "You are the client" : isAgent ? "Assigned to you" : "Observer";
  const { task, criteria } = parseJobDetails(job.description);
  const timeoutState = getTimeoutState(job, chainTimestamp);
  const terminalCopy = terminalOutcomeCopy(job, agentStake);
  const timeoutCopy = timeoutState.active && !timeoutState.chainTimePending
    ? timeoutOutcomeCopy(job, timeoutRole, timeoutState.remainingSeconds, timeoutState.claimable, agentStake)
    : "";
  const { clientAmount, agentAmount } = splitAmounts(job);

  return (
    <article className={`job job-${pillClass}`}>
      <div className="job-main">
        <div className="job-copy">
          <div className="job-topline">
            <span className="job-id">JOB #{job.id.toString()}</span>
            <span className="pill">{job.category}</span>
            <span className={`pill ${pillClass}`}>{JOB_STATUS[status]}</span>
          </div>
          <h3>{task}</h3>
          {criteria && (
            <div className="criteria-box">
              <span>Acceptance criteria</span>
              <p>{criteria}</p>
            </div>
          )}
          <div className="job-meta-grid">
            <div className="job-meta-item">
              <span>Client</span>
              <strong>{short(job.client)}</strong>
            </div>
            <div className="job-meta-item">
              <span>Agent</span>
              <strong>
                {job.agent === "0x0000000000000000000000000000000000000000" ? (
                  "Unassigned"
                ) : (
                  <a href={`/agents/${job.agent}`}>{short(job.agent)}</a>
                )}
              </strong>
            </div>
            <div className="job-meta-item">
              <span>Your role</span>
              <strong>{role}</strong>
            </div>
          </div>
          {job.deliverableURI && (
            <a className="delivery-link" href={job.deliverableURI} target="_blank" rel="noreferrer">
              Delivery: {job.deliverableURI}
            </a>
          )}
          {timeoutState.active && (
            <div className={`timeout-panel ${timeoutState.claimable ? "claimable" : "waiting"}`}>
              <strong>
                {timeoutState.chainTimePending
                  ? "Waiting for latest chain time"
                  : timeoutState.claimable
                    ? "Deadline reached"
                    : "Chain-confirmed deadline"}
              </strong>
              {timeoutCopy && <p>{timeoutCopy}</p>}
              {timeoutState.claimable && <small>{PERMISSIONLESS_SETTLEMENT_COPY}</small>}
            </div>
          )}
          {terminalCopy && <div className="timeout-panel terminal"><strong>Final timeout outcome</strong><p>{terminalCopy}</p></div>}
        </div>

        <div className="job-side">
          <div className="reward-card">
            <span>Reward</span>
            <strong>{fmt(job.reward)} USDC</strong>
          </div>
        </div>
      </div>

      <div className="job-actions">
        {status === 0 && !isClient && (
          <div className="acceptance-note">
            <b>Before accepting</b>
            <span>Confirm you can satisfy the acceptance criteria and submit an accessible delivery link. Payment is released after client approval.</span>
          </div>
        )}
        {status === 0 && !isClient && (
          <button className="ok" disabled={connected && (disabled || !registered || busy === "accept" + job.id)} onClick={connected ? onAccept : onConnect}>
            {!connected ? "Connect wallet to accept job" : !registered ? "Register as agent first" : busy === "accept" + job.id ? "Accepting…" : "Accept job"}
          </button>
        )}
        {status === 0 && isClient && (
          <button className="danger" disabled={connected && (disabled || busy === "cancel" + job.id)} onClick={connected ? onCancel : onConnect}>
            {!connected ? "Connect wallet to cancel job" : busy === "cancel" + job.id ? "Canceling…" : "Cancel and refund"}
          </button>
        )}
        {status === 1 && isAgent && (
          <div className="delivery-form">
            <label className="sr-only" htmlFor={`delivery-uri-${job.id}`}>Deliverable URI</label>
            <input id={`delivery-uri-${job.id}`} value={uri} onChange={(e) => setUri(e.target.value)} placeholder="Delivery link (ipfs:// or https://)" />
            <button disabled={connected && (disabled || !uri || busy === "submit" + job.id)} onClick={() => connected ? onSubmit(uri) : onConnect()}>
              {!connected ? "Connect wallet to submit delivery" : busy === "submit" + job.id ? "Submitting…" : "Submit delivery"}
            </button>
            <p className="delivery-hint">Use a public or client-accessible Google Doc, Notion page, GitHub file, IPFS URI, or HTTPS link.</p>
          </div>
        )}
        {status === 2 && isClient && (
          <div className="submitted-actions">
            <button className="ok" disabled={connected && (disabled || busy === "approve" + job.id)} onClick={connected ? onApprove : onConnect}>
              {!connected ? "Connect wallet to approve and pay" : busy === "approve" + job.id ? "Approving…" : "Approve and pay"}
            </button>
            <button ref={disputeTriggerRef} className="danger" disabled={connected && (disabled || disputeTimeout == null || busy === "dispute" + job.id)} onClick={() => connected ? setConfirmingDispute(true) : onConnect()}>
              {!connected ? "Connect wallet to dispute job" : busy === "dispute" + job.id ? "Starting dispute…" : "Dispute"}
            </button>
            {confirmingDispute && (
              <div className="modal-backdrop" role="presentation">
                <div ref={disputeDialogRef} className="dispute-confirmation" role="dialog" aria-modal="true" aria-labelledby={`dispute-title-${job.id}`} aria-describedby={`dispute-description-${job.id}`}>
                  <h3 id={`dispute-title-${job.id}`}>Disputing does not get your money back.</h3>
                  <p id={`dispute-description-${job.id}`}>No one reviews a dispute — there is no arbiter, no appeal, and no support team. Disputing only changes how the escrow is split when the dispute window closes.</p>
                  <p>If you dispute, in {formatDuration(disputeTimeout)} the escrow splits automatically: {formatUsdcAmount(clientAmount)} USDC to you, {formatUsdcAmount(agentAmount)} USDC to the agent. That split is fixed and cannot be changed.</p>
                  <p>If you approve instead, the agent is paid in full. If you do nothing, the agent is paid in full when the approval window closes.</p>
                  <div className="confirmation-actions">
                    <button className="danger" onClick={() => { setConfirmingDispute(false); onDispute(); }}>Dispute and accept the split</button>
                    <button className="ghost" data-modal-initial autoFocus onClick={() => setConfirmingDispute(false)}>Go back</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {timeoutState.active && timeoutState.claimable && (
          <button className="timeout-claim" disabled={connected && (disabled || busy === "claim" + job.id)} onClick={connected ? onClaim : onConnect}>
            {!connected ? "Connect wallet to settle job" : busy === "claim" + job.id ? "Revalidating chain state…" : "Settle job"}
          </button>
        )}
      </div>
    </article>
  );
}

function humanError(e) {
  const m = (e && (e.shortMessage || e.message)) || "Unknown error";
  if (/User rejected|User denied/i.test(m)) return "You rejected the transaction.";
  if (/insufficient funds/i.test(m)) return "Insufficient balance. Native USDC is required for gas.";
  if (/transfer amount exceeds balance/i.test(m)) return "Your ERC-20 USDC balance is too low.";
  return m;
}

function parseRewardFilter(value) {
  if (!String(value).trim()) return null;
  try {
    return parseUnits(String(value).trim(), USDC_DECIMALS);
  } catch {
    return null;
  }
}

function splitAmounts(job) {
  return splitDisputedReward(job.reward, job.clientShareOnDispute);
}
