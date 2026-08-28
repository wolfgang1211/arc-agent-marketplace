"use client";

import { useEffect, useMemo, useState } from "react";
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
import { arcTestnet, USDC_ADDRESS, USDC_DECIMALS, EXPLORER, FAUCET } from "../lib/chain";
import {
  CONTRACT_ADDRESS,
  AGENT_STAKE,
  MARKETPLACE_ABI,
  ERC20_ABI,
  JOB_STATUS,
} from "../lib/contract";
import { fetchDiscovery, filterAndSortOpenJobs } from "../lib/discovery.mjs";
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
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [pageOffset, setPageOffset] = useState(0n);
  const [chainTimestamp, setChainTimestamp] = useState(null);

  const wrongNetwork = isConnected && chainId !== arcTestnet.id;
  const noContract = !CONTRACT_ADDRESS;

  const { data: jobsPage, refetch: refetchJobs } = useReadContract({
    address: CONTRACT_ADDRESS || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "getJobsPaged",
    args: [pageOffset, JOB_PAGE_SIZE],
    query: { enabled: !!CONTRACT_ADDRESS, refetchInterval: 8000 },
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

  const discoveryFilters = useMemo(() => ({
    category: categoryFilter,
    rewardMin: parseRewardFilter(rewardMin),
    rewardMax: parseRewardFilter(rewardMax),
    sort: jobSort,
    first: 100,
  }), [categoryFilter, rewardMin, rewardMax, jobSort]);

  useEffect(() => {
    if (!DISCOVERY_ENDPOINT) return;
    const controller = new AbortController();
    setDiscoveryLoading(true);
    setDiscoveryError("");
    fetchDiscovery(DISCOVERY_ENDPOINT, discoveryFilters, (url, options) => fetch(url, { ...options, signal: controller.signal }))
      .then((result) => setIndexedDiscovery(result))
      .catch((error) => {
        if (error.name !== "AbortError") setDiscoveryError(error.message);
      })
      .finally(() => setDiscoveryLoading(false));
    return () => controller.abort();
  }, [discoveryFilters]);

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
      setDiscoveryLoading(true);
      refreshes.push(fetchDiscovery(DISCOVERY_ENDPOINT, discoveryFilters)
        .then((result) => { setIndexedDiscovery(result); setDiscoveryError(""); })
        .catch((error) => setDiscoveryError(error.message))
        .finally(() => setDiscoveryLoading(false)));
    }
    await Promise.allSettled(refreshes);
  };
  const jobs = jobsPage?.[0] || [];
  const totalJobs = jobsPage?.[1] || 0n;
  const openOnPage = filterAndSortOpenJobs(jobs, discoveryFilters);
  const lifecycleJobs = jobs.filter((job) => Number(job.status) !== 0);
  const jobList = [...lifecycleJobs, ...openOnPage].sort((a, b) => Number(b.id - a.id));
  const pagination = getPaginationState(pageOffset, JOB_PAGE_SIZE, totalJobs);
  const statusCounts = getJobStatusCounts(jobList);

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

  if (!isConnected) {
    return (
      <Shell>
        <div className="connect-shell">
          <div className="connect-hero">
            <div className="eyebrow">Arc Testnet Marketplace</div>
            <h1>Hire and pay AI agents with USDC escrow.</h1>
            <p>
              Connect a browser wallet to register as an agent, post jobs, lock USDC in escrow,
              and release payment when the delivery is approved.
            </p>
            <div className="connect-stats">
              <span>USDC escrow</span>
              <span>Arc Testnet</span>
              <span>No real funds</span>
            </div>
          </div>

          <div className="wallet-card">
            <div className="wallet-icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19a1 1 0 0 1 1 1v2H6.5A2.5 2.5 0 0 1 4 5.5v12A2.5 2.5 0 0 0 6.5 20H20a1 1 0 0 0 1-1V9.5a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M17 14h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
              </svg>
            </div>
            <h2>Connect wallet</h2>
            <p className="muted">Use MetaMask, Rabby, or another injected browser wallet.</p>
            <div className="wallet-actions">
              {connectors.map((c) => (
                <button className="connect-button" key={c.uid} onClick={() => connect({ connector: c })} disabled={connecting}>
                  <span>{connecting ? "Connecting…" : `Connect ${c.name}`}</span>
                  <span className="arrow">→</span>
                </button>
              ))}
            </div>
            <div className="wallet-help">
              New to wallets? <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask</a>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      right={
        <ConnectedWallet address={address} onDisconnect={() => disconnect()} />
      }
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
        <div className={`banner ${msg.type}`}>
          {msg.text}{" "}
          {msg.link && <a href={msg.link} target="_blank" rel="noreferrer">View on Explorer →</a>}
        </div>
      )}

      <section className="dashboard-grid">
        <div className="card balance-card metric-card metric-card-large">
          <div className="metric-label">Wallet balance</div>
          <div className="balance-value">{fmt(usdcBalance)} USDC</div>
          <p className="muted">ERC-20 USDC available for escrow deposits and rewards.</p>
          <a href={FAUCET} target="_blank" rel="noreferrer">
            <button className="ghost">Get test USDC</button>
          </a>
        </div>
        <MetricCard label="Open on page" value={statusCounts.open} tone="blue" />
        <MetricCard label="Active on page" value={statusCounts.active} tone="yellow" />
        <MetricCard label="Settled on page" value={statusCounts.settled} tone="green" />
      </section>

      <p className="network-note">
        Arc gas uses <b>native USDC</b> with 18 decimals. Escrow uses <b>ERC-20 USDC</b> with 6 decimals.
      </p>

      <section className="action-grid">
        <RegisterAgent agent={agent} busy={busy} disabled={wrongNetwork || noContract}
          onRegister={(name, skill, fee) =>
            run("register", async () => {
              if (!agent?.registered) {
                const approveHash = await writeContractAsync({
                  address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve",
                  args: [CONTRACT_ADDRESS, AGENT_STAKE],
                });
                assertSuccessfulReceipt(await waitForTransactionReceipt(config, { hash: approveHash }));
              }
              return write("registerAgent", [name, skill, fee ? parseUnits(fee, USDC_DECIMALS) : 0n]);
            })
          } />

        <PostJob busy={busy} disabled={wrongNetwork || noContract}
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

      <section className="card jobs-panel">
        <div className="section-head">
          <div>
            <div className="eyebrow small-eyebrow">Marketplace</div>
            <h2>Available jobs</h2>
            <p className="muted">Track open requests, chain-confirmed deadlines, and terminal settlements in bounded pages.</p>
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
          <span>{totalJobs.toString()} total on-chain jobs · showing {pagination.start.toString()}–{pagination.end.toString()}</span>
          <span>{discoveryLoading ? "Updating indexed recommendations…" : "Bounded on-chain page"}</span>
        </div>
        {discoveryError && <div className="banner warn">Indexer unavailable: {discoveryError}. Showing the last indexed result.</div>}

        {jobList.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✦</div>
            <h3>No jobs posted yet</h3>
            <p>Create the first escrow-backed request and it will appear here.</p>
          </div>
        ) : (
          <div className="jobs-list">
            {jobList.map((j) => (
              <JobCard key={j.id.toString()} job={j} me={address} agent={agent} busy={busy}
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
        <div className="pagination" aria-label="Job pages">
          <button className="ghost" disabled={!pagination.hasPrevious} onClick={() => setPageOffset(pagination.previousOffset)}>Previous</button>
          <span>Jobs {pagination.start.toString()}–{pagination.end.toString()} of {totalJobs.toString()}</span>
          <button className="ghost" disabled={!pagination.hasNext} onClick={() => setPageOffset(pagination.nextOffset)}>Next</button>
        </div>
      </section>

      <RankedAgents agents={indexedDiscovery?.agents || []} indexerConfigured={!!DISCOVERY_ENDPOINT} loading={discoveryLoading} />
    </Shell>
  );
}

function RankedAgents({ agents, indexerConfigured, loading }) {
  return (
    <section className="card ranked-agents-panel">
      <div className="section-head">
        <div>
          <div className="eyebrow small-eyebrow">Reputation</div>
          <h2>Recommended agents</h2>
          <p className="muted">Ranked by distinct approved clients since the latest slash, then approved deliveries.</p>
        </div>
      </div>
      {!indexerConfigured ? (
        <div className="profile-empty">Connect the Envio GraphQL endpoint to enable current-era agent recommendations.</div>
      ) : loading && agents.length === 0 ? (
        <div className="profile-empty">Loading ranked agents…</div>
      ) : agents.length === 0 ? (
        <div className="profile-empty">No approved agent history has been indexed yet.</div>
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
                <strong>{rankedAgent.currentDistinctClients}</strong>
                <small>distinct clients</small>
              </span>
              <span className="ranked-agent-metric">
                <strong>{rankedAgent.currentApprovedDeliveries}</strong>
                <small>approved</small>
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
    <div className="container">
      <div className="header">
        <div>
          <div className="brand">Arc <span>AI Agent</span> Marketplace</div>
          <p className="sub">Arc Testnet • USDC escrow • gas is paid with USDC</p>
        </div>
        {right}
      </div>
      {children}
    </div>
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

function RegisterAgent({ agent, onRegister, busy, disabled }) {
  const [name, setName] = useState("");
  const [skill, setSkill] = useState("");
  const [proof, setProof] = useState("");
  const [fee, setFee] = useState("");
  const registered = agent && agent.registered;
  const profile = proof ? `${skill}\nAI agent verification: ${proof}` : skill;
  return (
    <div className="card">
      <h2>1) Register as an agent {registered && <span className="pill done">Registered: {agent.name}</span>}</h2>
      <div className="row">
        <div className="field"><label>Agent name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aria" /></div>
        <div className="field"><label>Skills</label><input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="summaries, translation, research…" /></div>
        <div className="field"><label>Suggested fee (USDC)</label><input value={fee} onChange={(e) => setFee(e.target.value)} placeholder="50" /></div>
      </div>
      <div className="field">
        <label>AI agent verification note</label>
        <input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Model/workflow used, demo link, portfolio, or operating rules…" />
      </div>
      <div className="info-box compact">
        <b>Recommended:</b> describe how your AI agent works and what evidence clients can review. For production, this should become a stronger verification flow.
      </div>
      <button disabled={disabled || busy === "register" || !name} onClick={() => onRegister(name, profile, fee)}>
        {busy === "register" ? "Registering…" : registered ? "Update profile" : "Register agent"}
      </button>
    </div>
  );
}

function PostJob({ onPost, busy, disabled }) {
  const [desc, setDesc] = useState("");
  const [criteria, setCriteria] = useState("");
  const [reward, setReward] = useState("");
  const [category, setCategory] = useState("");
  const combinedDescription = criteria ? `${desc}${SECTION_SPLIT}${criteria}` : desc;
  return (
    <div className="card">
      <h2>2) Post a job (USDC escrow)</h2>
      <div className="info-box">
        <b>Tips for a good job post</b>
        <ul>
          <li>Describe the expected output and format.</li>
          <li>Add links, files, context, or source material.</li>
          <li>Define clear acceptance criteria before locking funds.</li>
          <li>Set a reward that matches complexity and urgency.</li>
        </ul>
      </div>
      <div className="field"><label>Job description</label><textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Summarize this PDF into 10 bullet points. Include key risks, numbers, and a final recommendation." /></div>
      <div className="field"><label>Acceptance criteria</label><textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="Delivery is accepted if it includes: summary, key takeaways, risks, source references, and an accessible final link." /></div>
      <div className="field"><label>Category</label><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="research" /></div>
      <div className="field"><label>Reward (USDC)</label><input value={reward} onChange={(e) => setReward(e.target.value)} placeholder="100" /></div>
      <button disabled={disabled || busy === "post" || !desc || !reward || !category.trim()} onClick={() => onPost(combinedDescription, reward, category.trim())}>
        {busy === "post" ? "Approving, then posting…" : "Lock USDC and publish job"}
      </button>
      <p className="muted" style={{ marginTop: 8 }}>Two signatures are required: first USDC <b>approve</b>, then <b>postJob</b>.</p>
    </div>
  );
}

function JobCard({ job, me, agent, onAccept, onSubmit, onApprove, onDispute, onClaim, onCancel, busy, disabled, chainTimestamp, disputeTimeout }) {
  const [uri, setUri] = useState("");
  const [confirmingDispute, setConfirmingDispute] = useState(false);
  const status = Number(job.status);
  const isClient = me && me.toLowerCase() === job.client.toLowerCase();
  const isAgent = me && me.toLowerCase() === job.agent.toLowerCase();
  const registered = agent && agent.registered;
  const pillClass = ["open", "progress", "submitted", "disputed", "done", "cancel", "expired-refund", "expired-payout", "expired-split"][status];
  const timeoutRole = isClient ? "client" : isAgent ? "agent" : "observer";
  const role = isClient ? "You are the client" : isAgent ? "Assigned to you" : "Observer";
  const { task, criteria } = parseJobDetails(job.description);
  const timeoutState = getTimeoutState(job, chainTimestamp);
  const terminalCopy = terminalOutcomeCopy(job);
  const timeoutCopy = timeoutState.active && !timeoutState.chainTimePending
    ? timeoutOutcomeCopy(job, timeoutRole, timeoutState.remainingSeconds, timeoutState.claimable)
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
          <button className="ok" disabled={disabled || !registered || busy === "accept" + job.id} onClick={onAccept}>
            {!registered ? "Register as agent first" : busy === "accept" + job.id ? "Accepting…" : "Accept job"}
          </button>
        )}
        {status === 0 && isClient && (
          <button className="danger" disabled={disabled || busy === "cancel" + job.id} onClick={onCancel}>
            {busy === "cancel" + job.id ? "Canceling…" : "Cancel and refund"}
          </button>
        )}
        {status === 1 && isAgent && (
          <div className="delivery-form">
            <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="Delivery link (ipfs:// or https://)" />
            <button disabled={disabled || !uri || busy === "submit" + job.id} onClick={() => onSubmit(uri)}>
              {busy === "submit" + job.id ? "Submitting…" : "Submit delivery"}
            </button>
            <p className="delivery-hint">Use a public or client-accessible Google Doc, Notion page, GitHub file, IPFS URI, or HTTPS link.</p>
          </div>
        )}
        {status === 2 && isClient && (
          <div className="submitted-actions">
            <button className="ok" disabled={disabled || busy === "approve" + job.id} onClick={onApprove}>
              {busy === "approve" + job.id ? "Approving…" : "Approve and pay"}
            </button>
            <button className="danger" disabled={disabled || disputeTimeout == null || busy === "dispute" + job.id} onClick={() => setConfirmingDispute(true)}>
              {busy === "dispute" + job.id ? "Starting dispute…" : "Dispute"}
            </button>
            {confirmingDispute && (
              <div className="modal-backdrop" role="presentation">
                <div className="dispute-confirmation" role="dialog" aria-modal="true" aria-labelledby={`dispute-title-${job.id}`}>
                  <h3 id={`dispute-title-${job.id}`}>Disputing does not get your money back.</h3>
                  <p>No one reviews a dispute — there is no arbiter, no appeal, and no support team. Disputing only changes how the escrow is split when the dispute window closes.</p>
                  <p>If you dispute, in {formatDuration(disputeTimeout)} the escrow splits automatically: {formatUsdcAmount(clientAmount)} USDC to you, {formatUsdcAmount(agentAmount)} USDC to the agent. That split is fixed and cannot be changed.</p>
                  <p>If you approve instead, the agent is paid in full. If you do nothing, the agent is paid in full when the approval window closes.</p>
                  <div className="confirmation-actions">
                    <button className="danger" onClick={() => { setConfirmingDispute(false); onDispute(); }}>Dispute and accept the split</button>
                    <button className="ghost" onClick={() => setConfirmingDispute(false)}>Go back</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {timeoutState.active && timeoutState.claimable && (
          <button className="timeout-claim" disabled={disabled || busy === "claim" + job.id} onClick={onClaim}>
            {busy === "claim" + job.id ? "Revalidating chain state…" : "Settle job"}
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
