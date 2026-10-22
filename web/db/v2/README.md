# Step 3A database boundary

`createPgliteDb({ dataDir })` and `createPgDb({ pool })` expose the same small async boundary:

- `query(sql, params)` returns `{ rows, rowCount }`.
- `transaction(fn)` supplies a transaction-local `tx.query`; true nested transactions are rejected before enqueue, while independent concurrent transactions remain queued.
- A transaction handle is frozen and expires before commit/release; later `query` or migration execution fails with `TRANSACTION_CLOSED`.
- `close()` waits for queued work and is idempotent. For an injected PostgreSQL pool, it drains the adapter but does not call `pool.end()`; pool ownership remains with the caller.
- `capabilities` identifies the adapter and its persistence/serialization limits.

PGlite uses `C:/Users/<user>/AppData/Local/hermes/state/alphaboard-v2/pglite` by default. Tests pass explicit Hermes scratch directories. The PGlite adapter is one serialized connection; shared filesystem access by multiple processes is not supported. The PostgreSQL adapter never reads an environment URL and only uses the injected pool.

`migrate(db)` applies the ordered `001-core` and `002-indexer` migrations without editing 001, records one SHA-256 checksum per migration in `v2_schema_migrations`, detects drift for either file, and is idempotent. The ordered set is applied atomically on both adapters; the result retains `migrationId`, `checksum`, and `applied` compatibility fields and also includes `results`. Schema identifiers are `v2_`; protocol 256-bit values use `NUMERIC(78,0)` and must be passed/read as strings. The legacy 001 index tables are preserved; fork-aware persistence uses `v2_indexer_blocks_fork` and `v2_indexer_events_fork`.

This step does not claim PostgreSQL server behavior for PGlite. Production PostgreSQL roles/TLS, WAL/PITR, multiprocess ownership, extension availability, and network behavior remain deployment gates.
