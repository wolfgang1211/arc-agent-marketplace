import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EVENT_NAMES,
  formatEventNotification,
  processEventRange,
} from "../src/listener.mjs";
import { createNotificationChannel } from "../src/channels.mjs";
import { createFileState } from "../src/state.mjs";

const CONTRACT = "0xFc7dE289e02FCFB4268AE8f0e49991D2Eafe5C87";
const TX = `0x${"ab".repeat(32)}`;
const ADDRESS_A = `0x${"11".repeat(20)}`;
const ADDRESS_B = `0x${"22".repeat(20)}`;

function log(eventName, blockNumber, logIndex, args = {}) {
  return { eventName, blockNumber: BigInt(blockNumber), logIndex, transactionHash: TX, args };
}

function memoryState(initial = null) {
  let cursor = initial;
  const saves = [];
  return {
    load: async () => cursor,
    save: async (next) => { cursor = next; saves.push(next); },
    current: () => cursor,
    saves,
  };
}

test("listener subscribes to exactly the five roadmap events", () => {
  assert.deepEqual(EVENT_NAMES, [
    "JobPosted",
    "JobAccepted",
    "DeliverableSubmitted",
    "JobApproved",
    "AgentSlashed",
  ]);
});

test("all roadmap events produce actionable plain-text notifications", () => {
  const fixtures = [
    log("JobPosted", 10, 0, { jobId: 7n, client: ADDRESS_A, reward: 5_000000n, description: "Summarize https://example.com", category: "research" }),
    log("JobAccepted", 11, 0, { jobId: 7n, agent: ADDRESS_B }),
    log("DeliverableSubmitted", 12, 0, { jobId: 7n, deliverableURI: "https://example.com/result" }),
    log("JobApproved", 13, 0, { jobId: 7n, agent: ADDRESS_B, reward: 5_000000n }),
    log("AgentSlashed", 14, 0, { agent: ADDRESS_B, amount: 10_000000n }),
  ];

  const messages = fixtures.map((entry) => formatEventNotification(entry));
  assert.match(messages[0], /New job #7 · 5 USDC · research/);
  assert.match(messages[0], /Summarize https:\/\/example.com/);
  assert.match(messages[1], /Job #7 accepted/);
  assert.match(messages[2], /Deliverable submitted for job #7/);
  assert.match(messages[3], /Job #7 approved · 5 USDC paid/);
  assert.match(messages[4], /Agent slashed · 10 USDC/);
  for (const message of messages) assert.match(message, new RegExp(`${TX}$`));
});

test("cursor persistence prevents duplicate delivery after restart", async () => {
  const entries = [
    log("JobPosted", 20, 1, { jobId: 8n, client: ADDRESS_A, reward: 6_000000n, description: "One", category: "research" }),
    log("JobAccepted", 21, 0, { jobId: 8n, agent: ADDRESS_B }),
  ];
  const state = memoryState();
  const sent = [];
  const client = { getContractEvents: async () => [...entries].reverse() };
  const channel = { send: async (message) => sent.push(message) };

  const first = await processEventRange({ client, channel, state, contractAddress: CONTRACT, fromBlock: 20n, toBlock: 21n });
  const second = await processEventRange({ client, channel, state, contractAddress: CONTRACT, fromBlock: 20n, toBlock: 21n });

  assert.equal(first.delivered, 2);
  assert.equal(second.delivered, 0);
  assert.equal(sent.length, 2);
  assert.deepEqual(state.current(), { blockNumber: "21", logIndex: Number.MAX_SAFE_INTEGER, transactionHash: null });
});

test("a channel failure advances only through the last delivered event", async () => {
  const entries = [
    log("JobPosted", 30, 0, { jobId: 9n, client: ADDRESS_A, reward: 5_000000n, description: "One", category: "research" }),
    log("JobAccepted", 30, 1, { jobId: 9n, agent: ADDRESS_B }),
  ];
  const state = memoryState();
  let calls = 0;
  const channel = {
    send: async () => {
      calls += 1;
      if (calls === 2) throw new Error("channel down");
    },
  };

  await assert.rejects(
    processEventRange({ client: { getContractEvents: async () => entries }, channel, state, contractAddress: CONTRACT, fromBlock: 30n, toBlock: 30n }),
    /channel down/,
  );
  assert.deepEqual(state.current(), { blockNumber: "30", logIndex: 0, transactionHash: TX });
});

test("Discord delivery disables mentions and Telegram delivery uses plain text", async () => {
  const requests = [];
  const fetchFn = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 204, text: async () => "" };
  };

  const discord = createNotificationChannel({ discordWebhookUrl: "https://discord.com/api/webhooks/test/value", fetchFn });
  await discord.send("@everyone job posted");
  const discordBody = JSON.parse(requests[0].options.body);
  assert.deepEqual(discordBody.allowed_mentions, { parse: [] });

  const telegram = createNotificationChannel({ telegramBotToken: "test-token", telegramChatId: "123", fetchFn });
  await telegram.send("<b>plain text</b>");
  const telegramBody = JSON.parse(requests[1].options.body);
  assert.equal(telegramBody.text, "<b>plain text</b>");
  assert.equal("parse_mode" in telegramBody, false);
});

test("file cursor survives a process restart without secrets or bigint JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arc-listener-"));
  const path = join(directory, "state.json");
  try {
    const firstProcess = createFileState(path);
    await firstProcess.save({ blockNumber: "42", logIndex: 3, transactionHash: TX });
    const secondProcess = createFileState(path);

    assert.deepEqual(await secondProcess.load(), { blockNumber: "42", logIndex: 3, transactionHash: TX });
    assert.doesNotMatch(await readFile(path, "utf8"), /token|webhook|private/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
