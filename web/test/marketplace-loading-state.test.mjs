import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MarketplaceDataState,
  resolveCollectionStatus,
} from "../lib/marketplace-data-state.mjs";

const renderState = (resource, status) => renderToStaticMarkup(
  React.createElement(MarketplaceDataState, { resource, status }),
);

test("a pending jobs source renders uncertainty, never a false empty marketplace", () => {
  const status = resolveCollectionStatus({ hasResponse: false, error: null, itemCount: 0 });
  const html = renderState("jobs", status);

  assert.equal(status, "loading");
  assert.match(html, /Loading jobs from Arc Testnet/);
  assert.doesNotMatch(html, /No jobs posted yet/);
  assert.doesNotMatch(html, /Create the first escrow-backed request/);
});

test("a pending agent source renders uncertainty, never false empty reputation", () => {
  const status = resolveCollectionStatus({ hasResponse: false, error: null, itemCount: 0 });
  const html = renderState("agents", status);

  assert.equal(status, "loading");
  assert.match(html, /Loading agent reputation/);
  assert.doesNotMatch(html, /No approved agent history found/);
});

test("loading, error, and confirmed-empty jobs have distinct copy", () => {
  const loading = renderState("jobs", "loading");
  const error = renderState("jobs", "error");
  const empty = renderState("jobs", "empty");

  assert.match(loading, /Loading jobs from Arc Testnet/);
  assert.match(error, /Jobs are temporarily unavailable/);
  assert.match(empty, /No jobs posted yet/);
  assert.equal(new Set([loading, error, empty]).size, 3);
});

test("empty is reachable only after a successful zero-item response", () => {
  assert.equal(resolveCollectionStatus({ hasResponse: false, error: null, itemCount: 0 }), "loading");
  assert.equal(resolveCollectionStatus({ hasResponse: false, error: new Error("rpc down"), itemCount: 0 }), "error");
  assert.equal(resolveCollectionStatus({ hasResponse: true, error: null, itemCount: 0 }), "empty");
  assert.equal(resolveCollectionStatus({ hasResponse: true, error: null, itemCount: 3 }), "ready");
});
