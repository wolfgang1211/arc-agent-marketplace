# Timeout UI — copy deck

Rules this copy follows:

- Say **who gets what**, in USDC, before the user clicks.
- Never imply a human or arbiter reviews anything. There is none.
- Never say "you will get your money back" unless that branch actually refunds.
- Amounts always shown to 6 decimals, never rounded up.

---

## Countdown (deadline not yet reached)

Shown on any job with a live deadline. `{t}` = relative time from chain clock.

**In progress**
> Delivery due in **{t}**. If the agent misses it, anyone can settle the job: you get your **{reward} USDC** back and the agent's stake is burned.

**Submitted, awaiting approval**
> You have **{t}** to approve or dispute. If you do nothing, anyone can settle the job and the agent is paid **{reward} USDC**.

*(agent's view of the same job)*
> The client has **{t}** to approve or dispute. If they do nothing, you can settle the job yourself and collect **{reward} USDC**.

**Disputed**
> Dispute window closes in **{t}**. No one reviews this. When it closes, the escrow is split at the fixed rate set when the job was posted: **{clientAmount} USDC** to the client, **{agentAmount} USDC** to the agent.

---

## Claimable (deadline passed)

Button label is the same in all three cases — **Settle job** — but the explanation differs. The button is available to anyone; the copy must state who benefits.

**Missed delivery**
> **Delivery deadline passed.** Settling refunds **{reward} USDC** to the client and burns the agent's **{stake} USDC** stake. The stake is not paid to anyone — it stays in the contract permanently.

**Not approved in time**
> **Approval deadline passed.** Settling pays **{reward} USDC** to the agent. The client's window to dispute has closed.

**Dispute expired**
> **Dispute window closed.** Settling splits the escrow at the rate fixed when the job was posted: **{clientAmount} USDC** to the client, **{agentAmount} USDC** to the agent.

Secondary line under all three, smaller:
> Anyone can settle an expired job. You pay only the network fee.

---

## Terminal states

Read-only. Says what happened, not what could happen.

**Expired refund**
> Settled — agent missed the delivery deadline. **{reward} USDC** refunded to the client. Agent's **{stake} USDC** stake was burned.

**Expired payout**
> Settled — client did not approve in time. **{reward} USDC** paid to the agent.

**Expired split**
> Settled — dispute window closed with no resolution. **{clientAmount} USDC** to the client, **{agentAmount} USDC** to the agent.

---

## Dispute — before the user commits

Shown as a confirmation step on the dispute action, not a tooltip. The user must read this before disputing.

> **Disputing does not get your money back.**
>
> No one reviews a dispute — there is no arbiter, no appeal, and no support team. Disputing only changes how the escrow is split when the dispute window closes.
>
> If you dispute, in **{disputeWindow}** the escrow splits automatically: **{clientAmount} USDC** to you, **{agentAmount} USDC** to the agent. That split is fixed and cannot be changed.
>
> If you approve instead, the agent is paid in full. If you do nothing, the agent is paid in full when the approval window closes.

Confirm button: **Dispute and accept the split**
Cancel button: **Go back**

---

## Error and edge states

**Deadline just passed, transaction reverted**
> The deadline had not passed on-chain yet. Chain time can run a few seconds behind. Try again shortly.

**Someone else settled it first**
> This job was already settled. Refreshing.

**Wallet on the wrong network**
> Switch to Arc Testnet to settle this job.

---

## Words to avoid

| Don't write | Because |
|---|---|
| "Claim your refund" | Only one of three branches refunds. |
| "Report a problem", "Raise a ticket" | Implies someone reads it. No one does. |
| "Resolve dispute" | Nothing gets resolved; it expires into a fixed split. |
| "Penalty", "fine" | The stake is burned, not collected by anyone. |
| "Instant", "guaranteed" | Settlement needs a transaction and can revert. |
