const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deploy, post, award, jump, invariant, DAY, H } = require("./helpers/v2-stage-c-fixture");

const MAX_ARBITRATION = 30n * BigInt(DAY);
const statusDisputed = 5n;
const statusCompleted = 6n;
const statusRefunded = 7n;

async function blockTimestamp(receipt) {
  return BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp);
}

async function send(tx) {
  const receipt = await (await tx).wait();
  return { receipt, timestamp: await blockTimestamp(receipt) };
}

async function openAndResume(e) {
  const initial = await award(e, await post(e));
  const opened = await send(e.market.connect(e.client).openDispute(1,initial.stateVersion));
  let j = await e.market.getJob(1);
  expect(j.status).to.equal(statusDisputed);
  await jump(5 * DAY);
  const resumed = await send(e.market.connect(e.owner).resumeWork(1, 0, H("resume"), H("evidence"), j.stateVersion));
  j = await e.market.getJob(1);
  const reopened = await send(e.market.connect(e.client).openDispute(1,j.stateVersion));
  j = await e.market.getJob(1);
  expect(j.status).to.equal(statusDisputed);
  return { j, opened, resumed, reopened };
}

function elapsed(start, end, deadline = null) {
  const capped = deadline == null || end < deadline ? end : deadline;
  return capped - start;
}

describe("AgentMarketplaceV2 cumulative dispute-time finalization", function () {
  const live = [];
  afterEach(async function () { for (const e of live.splice(0)) await invariant(e); });

  it("records episode time cumulatively when a resumed dispute times out", async function () {
    const e = await deploy(); live.push(e);
    let { j, opened, resumed, reopened } = await openAndResume(e);
    await jump(7 * DAY);
    const claimed = await send(e.market.connect(e.outsider).claimDisputeTimeout(1, j.stateVersion));
    const final = await e.market.getJob(1);
    const expected = elapsed(opened.timestamp, resumed.timestamp) + elapsed(reopened.timestamp, claimed.timestamp, reopened.timestamp + 7n * BigInt(DAY));
    expect(final.disputeTimeUsed).to.equal(expected);
    expect(final.disputeTimeUsed).to.be.gte(elapsed(opened.timestamp, resumed.timestamp));
    expect(final.status).to.equal(statusRefunded);
  });

  it("records episode time before arbiter terminal settlement", async function () {
    const e = await deploy(); live.push(e);
    let { j, opened, resumed, reopened } = await openAndResume(e);
    await jump(3 * DAY);
    const resolved = await send(e.market.connect(e.owner).resolveDispute(1, 4_000_000n, false, H("arbiter"), H("evidence"), j.stateVersion));
    const final = await e.market.getJob(1);
    const expected = elapsed(opened.timestamp, resumed.timestamp) + elapsed(reopened.timestamp, resolved.timestamp);
    expect(final.disputeTimeUsed).to.equal(expected);
    expect(final.status).to.equal(statusCompleted);
  });

  it("records episode time before mutual terminal settlement", async function () {
    const e = await deploy(); live.push(e);
    let { j, opened, resumed, reopened } = await openAndResume(e);
    await jump(3 * DAY);
    await send(e.market.connect(e.client).proposeMutual(1, 6_000_000n, 4_000_000n, reopened.timestamp + 10n * BigInt(DAY), j.stateVersion));
    j = await e.market.getJob(1);
    const accepted = await send(e.market.connect(e.operator).acceptMutual(1, j.stateVersion, 1));
    const final = await e.market.getJob(1);
    const expected = elapsed(opened.timestamp, resumed.timestamp) + elapsed(reopened.timestamp, accepted.timestamp);
    expect(final.disputeTimeUsed).to.equal(expected);
    expect(final.status).to.equal(statusCompleted);
  });

  it("keeps cumulative finalization bounded by the arbitration budget after heartbeat expiry", async function () {
    const e = await deploy(); live.push(e);
    let { j, opened, resumed, reopened } = await openAndResume(e);
    await jump(6 * DAY);
    const heartbeat = await send(e.market.connect(e.owner).heartbeatDispute(1, H("heartbeat"), H("evidence"), (await e.market.getJob(1)).stateVersion));
    await jump(30 * DAY);
    const claimed = await send(e.market.connect(e.outsider).claimDisputeTimeout(1, (await e.market.getJob(1)).stateVersion));
    const final = await e.market.getJob(1);
    const expected = elapsed(opened.timestamp, resumed.timestamp) + elapsed(reopened.timestamp, heartbeat.timestamp) + elapsed(heartbeat.timestamp, claimed.timestamp, heartbeat.timestamp + 7n * BigInt(DAY));
    expect(final.disputeTimeUsed).to.equal(expected);
    expect(final.disputeTimeUsed).to.be.lte(MAX_ARBITRATION);
    expect(final.status).to.equal(statusRefunded);
  });
});
