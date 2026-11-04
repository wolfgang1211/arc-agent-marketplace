# V2 UI screenshots — Microsoft Edge current

Real local captures from installed Microsoft Edge via Playwright (version 156.0.4314.50, channel: msedge, headless: true) against `http://127.0.0.1:3104` / chain 31337.

**Visual acceptance remains pending Yusuf + Claude.** `reader-unavailable` is an explicit request-abort fault injection for `/api/v2/**`; it does not fabricate response JSON or mutate state.

- Requested: 32
- Captured: 32
- Failed: 0
- Ledger: [ledger.json](./ledger.json)

- [01-desktop-jobs-list.png](./01-desktop-jobs-list.png) — 1440x1000, jobs-list, actor=client
- [02-desktop-job1Open.png](./02-desktop-job1Open.png) — 1440x1000, job1Open, actor=client
- [03-desktop-job2InProgress.png](./03-desktop-job2InProgress.png) — 1440x1000, job2InProgress, actor=client
- [04-desktop-job3Submitted.png](./04-desktop-job3Submitted.png) — 1440x1000, job3Submitted, actor=client
- [05-desktop-job4RevisionPending.png](./05-desktop-job4RevisionPending.png) — 1440x1000, job4RevisionPending, actor=client
- [06-desktop-job5Disputed.png](./06-desktop-job5Disputed.png) — 1440x1000, job5Disputed, actor=client
- [07-desktop-job6Completed.png](./07-desktop-job6Completed.png) — 1440x1000, job6Completed, actor=client
- [08-desktop-job7Refunded.png](./08-desktop-job7Refunded.png) — 1440x1000, job7Refunded, actor=client
- [09-desktop-new-form-empty.png](./09-desktop-new-form-empty.png) — 1440x1000, new-form-empty, actor=client
- [10-desktop-new-form-filled.png](./10-desktop-new-form-filled.png) — 1440x1000, new-form-filled, actor=client
- [11-desktop-accountclient.png](./11-desktop-accountclient.png) — 1440x1000, accountclient, actor=client
- [12-desktop-accountoperator.png](./12-desktop-accountoperator.png) — 1440x1000, accountoperator, actor=operator
- [13-desktop-resolverauthenticated.png](./13-desktop-resolverauthenticated.png) — 1440x1000, resolverauthenticated, actor=resolver
- [14-desktop-wallet-disconnected.png](./14-desktop-wallet-disconnected.png) — 1440x1000, wallet-disconnected, actor=client
- [15-desktop-wrong-network.png](./15-desktop-wrong-network.png) — 1440x1000, wrong-network, actor=client
- [16-desktop-reader-unavailable.png](./16-desktop-reader-unavailable.png) — 1440x1000, reader-unavailable, actor=client, **network-unreachable fault injection**
- [17-mobile-jobs-list.png](./17-mobile-jobs-list.png) — 390x844, jobs-list, actor=client
- [18-mobile-job1Open.png](./18-mobile-job1Open.png) — 390x844, job1Open, actor=client
- [19-mobile-job2InProgress.png](./19-mobile-job2InProgress.png) — 390x844, job2InProgress, actor=client
- [20-mobile-job3Submitted.png](./20-mobile-job3Submitted.png) — 390x844, job3Submitted, actor=client
- [21-mobile-job4RevisionPending.png](./21-mobile-job4RevisionPending.png) — 390x844, job4RevisionPending, actor=client
- [22-mobile-job5Disputed.png](./22-mobile-job5Disputed.png) — 390x844, job5Disputed, actor=client
- [23-mobile-job6Completed.png](./23-mobile-job6Completed.png) — 390x844, job6Completed, actor=client
- [24-mobile-job7Refunded.png](./24-mobile-job7Refunded.png) — 390x844, job7Refunded, actor=client
- [25-mobile-new-form-empty.png](./25-mobile-new-form-empty.png) — 390x844, new-form-empty, actor=client
- [26-mobile-new-form-filled.png](./26-mobile-new-form-filled.png) — 390x844, new-form-filled, actor=client
- [27-mobile-accountclient.png](./27-mobile-accountclient.png) — 390x844, accountclient, actor=client
- [28-mobile-accountoperator.png](./28-mobile-accountoperator.png) — 390x844, accountoperator, actor=operator
- [29-mobile-resolverauthenticated.png](./29-mobile-resolverauthenticated.png) — 390x844, resolverauthenticated, actor=resolver
- [30-mobile-wallet-disconnected.png](./30-mobile-wallet-disconnected.png) — 390x844, wallet-disconnected, actor=client
- [31-mobile-wrong-network.png](./31-mobile-wrong-network.png) — 390x844, wrong-network, actor=client
- [32-mobile-reader-unavailable.png](./32-mobile-reader-unavailable.png) — 390x844, reader-unavailable, actor=client, **network-unreachable fault injection**







## QA001 — isolated loopback Edge regression (2026-11-04)

- Chain: 31337 on an explicitly allocated loopback RPC port (never 8545).
- Origin: http://127.0.0.1:3104; browser: Microsoft Edge headless, existing installation.
- Captures: 12/12; transaction send attempts: 0.
- Ledger: [qa001-ledger.json](./qa001-ledger.json)
- [qa001-filled-chip-form-48-24-24utc-desktop.png](./qa001-filled-chip-form-48-24-24utc-desktop.png) — filled-chip-form-48-24-24utc, desktop, statuses=
- [qa001-filled-chip-form-48-24-24utc-mobile.png](./qa001-filled-chip-form-48-24-24utc-mobile.png) — filled-chip-form-48-24-24utc, mobile, statuses=
- [qa001-disconnected-next-connect-desktop.png](./qa001-disconnected-next-connect-desktop.png) — disconnected-next-connect, desktop, statuses=Open
- [qa001-disconnected-next-connect-mobile.png](./qa001-disconnected-next-connect-mobile.png) — disconnected-next-connect, mobile, statuses=Open
- [qa001-client-open-applications-empty-load-desktop.png](./qa001-client-open-applications-empty-load-desktop.png) — client-open-applications-empty-load, desktop, statuses=Open
- [qa001-operator-inprogress-delivery-visible-desktop.png](./qa001-operator-inprogress-delivery-visible-desktop.png) — operator-inprogress-delivery-visible, desktop, statuses=In progress
- [qa001-operator-revisionpending-delivery-visible-desktop.png](./qa001-operator-revisionpending-delivery-visible-desktop.png) — operator-revisionpending-delivery-visible, desktop, statuses=Revision pending
- [qa001-client-submitted-delivery-hidden-connected-approve-desktop.png](./qa001-client-submitted-delivery-hidden-connected-approve-desktop.png) — client-submitted-delivery-hidden-connected-approve, desktop, statuses=Submitted
- [qa001-client-submitted-delivery-hidden-connected-approve-mobile.png](./qa001-client-submitted-delivery-hidden-connected-approve-mobile.png) — client-submitted-delivery-hidden-connected-approve, mobile, statuses=Submitted
- [qa001-operator-inprogress-delivery-visible-mobile.png](./qa001-operator-inprogress-delivery-visible-mobile.png) — operator-inprogress-delivery-visible, mobile, statuses=In progress
- [qa001-operator-revisionpending-delivery-visible-mobile.png](./qa001-operator-revisionpending-delivery-visible-mobile.png) — operator-revisionpending-delivery-visible, mobile, statuses=Revision pending
- [qa001-client-open-applications-empty-load-mobile.png](./qa001-client-open-applications-empty-load-mobile.png) — client-open-applications-empty-load, mobile, statuses=Open
