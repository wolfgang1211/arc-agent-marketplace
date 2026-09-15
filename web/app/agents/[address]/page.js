"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { formatUnits, getAddress, isAddress } from "viem";
import { EXPLORER, USDC_DECIMALS } from "../../../lib/chain";
import { CONTRACT_ADDRESS, CONTRACT_DEPLOYMENT_BLOCK, JOB_STATUS, MARKETPLACE_ABI } from "../../../lib/contract";
import { categoryDistinctClients, currentEraCopy } from "../../../lib/profile.mjs";
import { machineTrust } from "../../../lib/machine-trust.mjs";
import { BrandLogo } from "../../brand-logo";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PROFILE_JOB_LIMIT = 100n;
const SECTION_SPLIT = "\n\nAcceptance criteria:\n";

const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const formatUsdc = (value) => {
  if (value == null) return "0";
  const formatted = formatUnits(value, USDC_DECIMALS);
  return formatted.includes(".") ? formatted.replace(/\.?0+$/, "") : formatted;
};
const formatDate = (timestamp) =>
  timestamp ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(Number(timestamp) * 1000)) : "—";
const deliveryHref = (uri) => {
  if (/^https?:\/\//i.test(uri)) return uri;
  if (/^ipfs:\/\//i.test(uri)) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  return "";
};
const statusClass = (status) => {
  if (status === 0) return "open";
  if (status === 1) return "progress";
  if (status === 2) return "submitted";
  if (status === 3) return "disputed";
  if ([4, 7].includes(status)) return "done";
  return "cancel";
};

export default function AgentProfilePage({ params }) {
  const rawAddress = params?.address || "";
  const validAddress = isAddress(rawAddress);
  const address = validAddress ? getAddress(rawAddress) : ZERO_ADDRESS;
  const canRead = Boolean(CONTRACT_ADDRESS && validAddress);
  const publicClient = usePublicClient();

  const { data: agent, isLoading: agentLoading, error: agentError, refetch: refetchAgent } = useReadContract({
    address: CONTRACT_ADDRESS || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "getAgent",
    args: [address],
    query: { enabled: canRead, refetchInterval: 12000 },
  });

  const { data: reputation, isLoading: reputationLoading, error: reputationError, refetch: refetchReputation } = useReadContract({
    address: CONTRACT_ADDRESS || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "getAgentReputation",
    args: [address],
    query: { enabled: canRead, refetchInterval: 12000 },
  });

  const {
    data: trustSnapshot,
    isLoading: slashLoading,
    error: slashError,
    refetch: refetchSlashes,
  } = useQuery({
    queryKey: ["agent-slashes", CONTRACT_ADDRESS, CONTRACT_DEPLOYMENT_BLOCK?.toString(), address],
    enabled: canRead && Boolean(publicClient) && CONTRACT_DEPLOYMENT_BLOCK !== null,
    refetchInterval: 12000,
    queryFn: async () => {
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const [logs, counters] = await Promise.all([publicClient.getLogs({
      address: CONTRACT_ADDRESS,
      event: MARKETPLACE_ABI.find((item) => item.type === "event" && item.name === "AgentSlashed"),
      args: { agent: address },
      fromBlock: CONTRACT_DEPLOYMENT_BLOCK,
      toBlock: block.number,
      strict: true,
      }), publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: MARKETPLACE_ABI,
        functionName: "getAgentReputation",
        args: [address],
        blockNumber: block.number,
      })]);
      const check = await publicClient.getBlock({ blockNumber: block.number });
      if (check.hash !== block.hash) throw new Error("Snapshot block changed; retry");
      return { logs, reputation: counters, fromBlock: CONTRACT_DEPLOYMENT_BLOCK, toBlock: block.number, blockHash: block.hash, chainId: publicClient.chain.id };
    },
  });

  const { data: jobCount, isLoading: jobCountLoading, error: jobsError, refetch: refetchJobCount } = useReadContract({
    address: CONTRACT_ADDRESS || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "jobCount",
    query: { enabled: canRead, refetchInterval: 12000 },
  });

  const recentOffset = typeof jobCount === "bigint" && jobCount > PROFILE_JOB_LIMIT
    ? jobCount - PROFILE_JOB_LIMIT
    : 0n;
  const {
    data: jobsPage,
    isLoading: jobsPageLoading,
    error: jobsPageError,
    refetch: refetchJobPage,
  } = useReadContract({
    address: CONTRACT_ADDRESS || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "getJobsPaged",
    args: [recentOffset, PROFILE_JOB_LIMIT],
    query: { enabled: canRead && typeof jobCount === "bigint", refetchInterval: 12000 },
  });
  const allJobs = useMemo(() => jobsPage?.[0] || [], [jobsPage]);
  const agentJobs = useMemo(
    () => allJobs
      .filter((job) => job.agent.toLowerCase() === address.toLowerCase())
      .sort((a, b) => Number(b.id - a.id)),
    [allJobs, address]
  );
  const categories = useMemo(
    () => [...new Set(agentJobs.map((job) => job.category.trim()).filter(Boolean))],
    [agentJobs]
  );

  const categoryContracts = categories.map((category) => ({
    address: CONTRACT_ADDRESS || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "getReputationByCategory",
    args: [address, category],
  }));
  const { data: categoryResults, refetch: refetchCategories } = useReadContracts({
    contracts: categoryContracts,
    query: { enabled: canRead && categoryContracts.length > 0, refetchInterval: 12000 },
  });

  const categoryScores = categories
    .map((category, index) => ({ category, score: categoryResults?.[index]?.result }))
    .filter(({ score }) => typeof score === "bigint")
    .sort((a, b) => Number(b.score - a.score));
  const verifiedDeliveries = agentJobs.filter((job) => Number(job.status) === 4 && job.deliverableURI);
  const trust = slashError ? null : machineTrust(trustSnapshot);
  const slashCount = trust?.integrity.slashEvents;
  const slashHistoryReady = typeof slashCount === "number";
  const [skills, verificationNote] = String(agent?.skill || "").split("\nAI agent verification: ");
  const isLoading = agentLoading || reputationLoading || jobCountLoading || slashLoading || jobsPageLoading;
  const categoryReadFailed = categoryResults?.some((result) => result.status === "failure");
  const readError = agentError || reputationError || jobsError || jobsPageError || categoryReadFailed;

  const refresh = () => {
    refetchAgent();
    refetchReputation();
    refetchSlashes();
    refetchJobCount();
    if (typeof jobCount === "bigint") refetchJobPage();
    if (categoryContracts.length > 0) refetchCategories();
  };

  if (!validAddress) {
    return <ProfileMessage title="Invalid agent address" copy="Use a valid EVM wallet address in the profile URL." />;
  }

  if (!CONTRACT_ADDRESS) {
    return <ProfileMessage title="Contract not configured" copy="This profile cannot load until NEXT_PUBLIC_CONTRACT_ADDRESS is configured." />;
  }

  return (
    <main className="profile-container">
      <nav className="profile-nav" aria-label="Profile navigation">
        <a href="/" className="profile-back" aria-label="AlphaBoard Agents home"><BrandLogo compact /></a>
        <span className="environment-badge">Testnet</span>
        <button className="ghost small" onClick={refresh}>Refresh contract data</button>
      </nav>

      {readError && (
        <div className="banner err">Contract data could not be loaded. Confirm that this deployment supports the profile API.</div>
      )}
      {slashError && (
        <div className="banner err">Lifetime slash history could not be loaded. Current reputation counters are hidden because their reset history is unknown.</div>
      )}

      <section className="profile-hero card">
        <div className="profile-identity">
          <div className="profile-avatar" aria-hidden="true">{agent?.name?.slice(0, 2).toUpperCase() || "AI"}</div>
          <div>
            <div className="profile-kicker">On-chain agent record</div>
            <h1>{isLoading ? "Loading agent…" : agent?.name || "Unregistered agent"}</h1>
            <a className="profile-address mono" href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">
              {short(address)} ↗
            </a>
          </div>
        </div>
        <div className={`profile-state ${agent?.registered ? "active" : "inactive"}`}>
          <span />{agent?.registered ? "Active registration" : "Not currently registered"}
        </div>
        <p className="profile-bio">{skills || "No skills or operating description published."}</p>
        {verificationNote && (
          <div className="profile-proof"><b>Operator-provided verification note</b><span>{verificationNote}</span></div>
        )}
      </section>

      <section className="profile-trust-grid" aria-label="Four-part machine trust profile">
        <TrustCard
          label="Delivery quality"
          value={trust ? `${trust.deliveryQuality.approved} approvals` : "Unavailable"}
          copy="Client-approved settlements in the counter window below. Approval is client consent, not independently verified content quality."
        />
        <TrustCard
          label="Reliability"
          value="Unavailable"
          copy="On-time history is not tracked by this reader. Current statuses and absence of slashes cannot prove delivery before a deadline."
        />
        <TrustCard
          label="Integrity"
          value={trust ? `${trust.integrity.disputes} disputes` : "Unavailable"}
          copy={trust ? `Dispute starts in the counter window, not findings of fault. Lifetime slashes: ${slashCount}. Slashed ${slashCount} time${slashCount === 1 ? "" : "s"}; ${trust.integrity.stakeLossEvents} positive-value losses, ${formatUsdc(trust.integrity.totalSlashed)} USDC total. No content-integrity verification.` : "Disputes and lifetime slashes require a complete snapshot; no clean-history claim is available."}
        />
        <TrustCard
          label="Demand"
          value={trust ? `${trust.demand.distinctClients} distinct clients` : "Unavailable"}
          copy="Distinct approving client addresses in the counter window. Repeat approvals do not add clients; addresses do not prove independent people or organic demand."
        />
      </section>

      <div className="profile-disclosure">
        <b>Data windows:</b> {trust ? <>
          Four-part snapshot on chain {trustSnapshot.chainId}, contract {CONTRACT_ADDRESS}, for this agent address only.
          {" "}Through block {trust.window.toBlock.toString()} ({trustSnapshot.blockHash}). Latest-block observation, no confirmation delay; not a finality guarantee.
          {" "}Approval, dispute and distinct-client counters: {trust.window.afterSlash ? "Since last slash (after the last slash transaction" : "Since deployment (starting"} in block {trust.window.counterFromBlock.toString()}).
          {" "}Lifetime slash events: deployment block {trust.window.fromBlock.toString()} through {trust.window.toBlock.toString()}, inclusive. Lifetime means this address on this deployment, not operator history.
        </> : "Four-part snapshot unavailable or loading; unknown observations are not zero."}
        {" "}Category and delivery/job lists below are separate rolling reads of the latest 100 marketplace jobs, not this agent’s latest 100 or its complete history. Category counters reset after a slash. No combined trust rating is calculated. Arc deployment behavior has not been independently verified here.
      </div>

      <section className="profile-columns">
        <div className="card profile-panel">
          <div className="profile-section-head">
            <div><div className="eyebrow small-eyebrow">Trust by specialty</div><h2>Categories</h2></div>
            <span className="pill">Approve-only</span>
          </div>
          {!slashHistoryReady ? (
            <EmptyProfileState copy="Category counters are hidden until lifetime slash history is available." />
          ) : categoryScores.length === 0 ? (
            <EmptyProfileState copy="No category reputation recorded yet." />
          ) : (
            <div className="category-list">
              {categoryScores.map(({ category, score }) => {
                const clientCount = categoryDistinctClients(score);
                return (
                  <div className="category-row" key={category}>
                    <div><strong>{category}</strong><span>{currentEraCopy("Approved client relationships", slashCount)}</span></div>
                    <b>{clientCount == null ? "Unavailable" : `${clientCount.toString()} distinct client${clientCount === 1n ? "" : "s"}`}</b>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card profile-panel">
          <div className="profile-section-head">
            <div><div className="eyebrow small-eyebrow">Approval evidence</div><h2>Client-approved delivery links</h2></div>
            <span className="pill done">{verifiedDeliveries.length}</span>
          </div>
          {verifiedDeliveries.length === 0 ? (
            <EmptyProfileState copy="No client-approved delivery links recorded yet." />
          ) : (
            <div className="delivery-list">
              {verifiedDeliveries.map((job) => (
                <article className="profile-delivery" key={job.id.toString()}>
                  <div>
                    <a href={`${EXPLORER}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Contract job #{job.id.toString()} ↗</a>
                    <p>{job.description.split(SECTION_SPLIT)[0]}</p>
                    <span>{job.category || "Uncategorized"} · {formatDate(job.createdAt)}</span>
                  </div>
                  {deliveryHref(job.deliverableURI) ? (
                    <a className="delivery-cta" href={deliveryHref(job.deliverableURI)} target="_blank" rel="noreferrer">Open delivery ↗</a>
                  ) : (
                    <span className="delivery-unavailable">Non-web delivery URI</span>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card profile-panel profile-history">
        <div className="profile-section-head">
          <div><div className="eyebrow small-eyebrow">Contract history</div><h2>Past jobs</h2></div>
          <span className="pill">{agentJobs.length} shown</span>
        </div>
        {agentJobs.length === 0 ? (
          <EmptyProfileState copy={isLoading ? "Loading job history…" : "No assigned jobs found in the contract history."} />
        ) : (
          <div className="profile-job-table">
            {agentJobs.map((job) => {
              const status = Number(job.status);
              return (
                <article className="profile-job-row" key={job.id.toString()}>
                  <div className="profile-job-id"><a href={`${EXPLORER}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">#{job.id.toString()} ↗</a></div>
                  <div className="profile-job-copy"><strong>{job.description.split(SECTION_SPLIT)[0]}</strong><span>{job.category || "Uncategorized"} · client {short(job.client)}</span></div>
                  <span className={`pill ${statusClass(status)}`}>{JOB_STATUS[status] || "Unknown"}</span>
                  <b className="profile-job-reward">{formatUsdc(job.reward)} USDC</b>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function TrustCard({ label, value, copy, primary = false }) {
  return (
    <div className={`card profile-trust-card ${primary ? "primary" : ""}`}>
      <span>{label}</span><strong>{value}</strong><p>{copy}</p>
    </div>
  );
}

function EmptyProfileState({ copy }) {
  return <div className="profile-empty">{copy}</div>;
}

function ProfileMessage({ title, copy }) {
  return (
    <main className="profile-container">
      <a href="/" className="profile-back">← Marketplace</a>
      <section className="card profile-message"><div className="empty-icon">✦</div><h1>{title}</h1><p>{copy}</p></section>
    </main>
  );
}
