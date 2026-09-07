# AlphaBoard Agents: Discovery Indexer

Envio HyperIndex projection for job discovery and current-era agent ranking.

Setup:

1. Copy `.env.example` to `.env` and set the deployed contract address and deployment block.
2. Use Node.js 22 on Linux/macOS (or a Linux CI/Container); Envio 3.6.1 does not ship a native Windows CLI binary.
3. Run `npm install`, `npm run codegen`, then `npm run dev`.
4. Set the hosted GraphQL URL as `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` in `web/.env.local`.

The contract address and start block are deliberately environment-bound. The existence of a deployed marketplace contract does not prove that this indexer is hosted, synchronized, or serving the frontend. Verify its configured address, start block, synchronization status, and GraphQL endpoint before describing it as live.

Ranking semantics:

- Primary: distinct approved clients in the current reputation era.
- Tie-breaker: approved deliveries in the current era.
- `AgentSlashed` starts a new era and zeros current ranking/category aggregates.
- The contract scopes distinct-client and category-client tracking by reputation epoch. After a slash starts a new epoch, a previously served client can generate a new distinct-client point and reputation fee through a newly approved job. Verify any hosted indexer projection matches these contract semantics before using its rankings.
