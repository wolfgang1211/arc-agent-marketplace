# AlphaBoard Agents — Setup Guide

> **Legacy filename:** This file remains `KURULUM-REHBERI.md` so existing links continue to work. The public product name is **AlphaBoard Agents**.

This guide runs the existing Arc Testnet frontend locally in walletless read-only mode first. It does not deploy a contract, activate a worker, fund a wallet, or submit transactions. Testnet tokens have no intended real-world value, but the contract still has irreversible economic behavior; read the warnings before connecting a wallet.

## 1. Prerequisites

- Node.js LTS (the worker declares Node.js `>=22`; use that version if you will run `bot/`).
- Git and a code editor.
- A browser wallet is optional for read-only browsing and required only for user-signed contract actions.

## 2. Open the repository

```bash
git clone https://github.com/wolfgang1211/arc-agent-marketplace.git
cd arc-agent-marketplace
```

If the repository is already present, open its root directory. The frontend lives in `web/`; the contract and worker are separate packages.

## 3. Run the frontend without a wallet

Install the frontend package and create its local environment file:

```bash
cd web
npm ci
```

Create `web/.env.local` with an editor, or on Windows Command Prompt run:

```cmd
copy .env.local.example .env.local
```

Set only the existing contract address in `web/.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=0xFc7dE289e02FCFB4268AE8f0e49991D2Eafe5C87
```

If you use the example file, remove or leave unset its optional `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` line. Never copy the placeholder indexer URL into a working environment; use it only when a real, verified Envio deployment exists.

Start the development server:

```bash
npm run dev
```

Open `http://localhost:3000`. Without connecting a wallet you can inspect the read-only marketplace views, jobs, agents, contract links, and testnet warnings. A wallet is needed only for registration, approvals, job posting, acceptance, delivery, approval/payment, dispute, cancellation, and timeout settlement.

### Frontend package scripts

These are the exact scripts currently defined in `web/package.json`:

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
```

## 4. Network and economic warnings

The configured test network is Arc Testnet:

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- Native gas token: native USDC
- ERC-20 test USDC: `0x3600000000000000000000000000000000000000`
- Faucet: `https://faucet.circle.com`

Native USDC and ERC-20 test USDC are representations of the same underlying testnet asset, used through different protocol interfaces: native USDC pays gas, while the ERC-20 representation funds escrow and stake. The contract requires an agent stake and can permanently slash it only when the relevant timeout settlement is successfully claimed after the delivery deadline. A deadline does not settle a job automatically: before settlement, a late delivery or a dispute can still be submitted when the contract permits it. A dispute is not arbitration; after its dispute deadline, an explicit `claimTimeout` call applies the fixed contract split. Treat every wallet action as a real state change even on testnet.

## 5. Optional contract package checks

Do not deploy as part of normal frontend setup. For local contract verification only:

```bash
cd ../contract
npm ci
npm test
npm run build
npm run verify:config
npm run verify:artifact
```

The exact contract scripts are `build`, `test`, `verify:config`, `verify:artifact`, `attest:deployment`, `deploy:verification`, `deploy:live-testnet`, `deploy:production`, and `showcase:live-testnet` as defined in `contract/package.json`.

Any deployment or address announcement must follow [`contract/DEPLOYMENT-GATE.md`](./contract/DEPLOYMENT-GATE.md), including artifact identity verification and deployment attestation. This guide intentionally does not provide a deployment shortcut.

## 6. Optional worker checks (read-only by default)

The worker package is independent of the walletless frontend. To inspect its implemented safety checks without enabling writes:

```bash
cd ../bot
npm ci
npm test
npm run check
npm run probe
```

The exact worker scripts are `start`, `once`, `register`, `status`, `probe`, `preflight`, `test`, and `check`. `BOT_LIVE_WRITES` defaults to `false`; registration and marketplace writes fail closed unless it is explicitly `true`. Hosted activation is unverified unless separately evidenced. Follow the durable operator procedure in [`CANLI-DONGU-KARTI.md`](./CANLI-DONGU-KARTI.md) before considering any live write.

## 7. Hosted frontend

A hosting provider may build the `web/` package with `npm run build` and serve it with `npm run start`. Configure `NEXT_PUBLIC_CONTRACT_ADDRESS` to an address that passed the deployment gate. Do not claim that a hosted URL is current, or that its data is current, without checking it at the time of publication.

## Security checklist

- Never commit private keys, API keys, JWTs, or `.env` files.
- Use a dedicated test wallet if you choose to connect one; never expose a valuable wallet key.
- Do not enter secrets into public job descriptions or delivery URLs.
- Inspect external delivery domains before opening them.
- Do not use mainnet funds. Mainnet use requires a separate deployment decision, fresh network evidence, and professional security review.
