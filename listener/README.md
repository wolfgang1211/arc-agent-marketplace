# AlphaBoard Agents: Event Listener

This read-only service watches the attested Arc Testnet marketplace and sends these events to Discord and/or Telegram:

- `JobPosted`
- `JobAccepted`
- `DeliverableSubmitted`
- `JobApproved`
- `AgentSlashed`

It never signs transactions and does not need a wallet or private key.

## Setup (Windows CMD)

Run from the repository root. Starting this service with configured destinations can send external messages; obtain the destination owner's approval first. Code in this repository does not establish that a notification service is currently active.

```cmd
cd listener
npm install
copy .env.example .env
```

Edit `.env` and configure one destination:

- Discord: `DISCORD_WEBHOOK_URL`
- Telegram: both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

Real values belong only in `.env`, which is gitignored. Messages are plain text. Discord mentions are disabled and Telegram markup is not enabled, so untrusted job descriptions cannot create mentions or formatting commands.

## Verify

```cmd
npm test
set LISTENER_STDOUT=true
npm run once
```

With no existing cursor, `once` starts at the current block and does not replay old events. To replay deliberately, set `LISTENER_START_BLOCK` and use a fresh `LISTENER_STATE_FILE`.

## Run continuously with PM2

```cmd
npx pm2 start ecosystem.config.cjs
npx pm2 status arc-marketplace-listener
npx pm2 logs arc-marketplace-listener --lines 50
```

After changing `.env`:

```cmd
npx pm2 restart arc-marketplace-listener --update-env
```

The durable cursor is stored at `data/state.json`. It advances only after successful delivery and prevents already-scanned confirmed logs from being sent again after restart. RPC scans are bounded to 500 blocks by default and wait for two confirmations.

## Failure behavior

- Channel delivery failure leaves the cursor before the failed event, so the next poll retries it.
- Public RPC errors are logged without destination URLs or credentials and retried by the HTTP transport.
- A new installation begins at the latest block to avoid flooding a channel with historical events.
