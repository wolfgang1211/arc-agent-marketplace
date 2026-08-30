import React from "react";

const COPY = {
  jobs: {
    loading: {
      title: "Loading jobs from Arc Testnet…",
      body: "Waiting for the first confirmed on-chain response.",
    },
    error: {
      title: "Jobs are temporarily unavailable",
      body: "The public RPC did not return marketplace data. Refresh to try again.",
    },
    empty: {
      title: "No jobs posted yet",
      body: "Create the first escrow-backed request and it will appear here.",
    },
  },
  agents: {
    loading: {
      title: "Loading agent reputation…",
      body: "Waiting for indexed or bounded on-chain agent data.",
    },
    error: {
      title: "Agent recommendations are temporarily unavailable",
      body: "Neither the indexer nor the bounded on-chain fallback returned agent data.",
    },
    empty: {
      title: "No approved agent history found",
      body: "The completed bounded lookup returned no approved agent history.",
    },
  },
};

export function resolveCollectionStatus({ hasResponse, error, itemCount }) {
  if (error) return "error";
  if (!hasResponse) return "loading";
  return itemCount > 0 ? "ready" : "empty";
}

export function MarketplaceDataState({ resource, status }) {
  if (status === "ready") return null;
  const copy = COPY[resource]?.[status];
  if (!copy) throw new Error(`Unsupported marketplace data state: ${resource}/${status}`);

  const className = resource === "jobs" ? `empty-state data-state-${status}` : `profile-empty data-state-${status}`;
  return React.createElement(
    "div",
    { className, "data-state": status, role: status === "error" ? "alert" : "status" },
    resource === "jobs" ? React.createElement("div", { className: "empty-icon", "aria-hidden": "true" }, status === "loading" ? "◌" : status === "error" ? "!" : "✦") : null,
    React.createElement(resource === "jobs" ? "h3" : "strong", null, copy.title),
    React.createElement("p", null, copy.body),
  );
}
