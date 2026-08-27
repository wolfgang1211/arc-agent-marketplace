# Arc Agent Marketplace indexer

Envio HyperIndex projection for job discovery and current-era agent ranking.

Setup:

1. Copy `.env.example` to `.env` and set the deployed contract address and deployment block.
2. Use Node.js 22 on Linux/macOS (or a Linux CI/Container); Envio 3.6.1 does not ship a native Windows CLI binary.
3. Run `npm install`, `npm run codegen`, then `npm run dev`.
4. Set the hosted GraphQL URL as `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` in `web/.env.local`.

The contract address and start block are deliberately environment-bound. Until a hardened contract is deployed, this indexer must not be described as Arc-live or Arc-verified.

Ranking semantics:

- Primary: distinct approved clients in the current reputation era.
- Tie-breaker: approved deliveries in the current era.
- `AgentSlashed` starts a new era and zeros current ranking/category aggregates.
- Lifetime agent/client and agent/category/client pairs remain stored because the contract mappings are not cleared by a slash. A previously served client cannot become a new distinct client after reset.
