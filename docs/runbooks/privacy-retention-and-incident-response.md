# Privacy, retention, and incident response

## Data boundary

Public data includes wallet addresses, public order/channel identifiers, amounts, statuses, block/transaction references, and protocol configuration. Private data includes payment values (for MVP, UPI ID and optional display label), session/CSRF material, signatures, managed credentials, raw transactions before broadcast, encryption keys, provider credentials, and incident evidence containing any of those values.

Private payment data must never enter chain calldata/events, subgraph entities, URLs/query strings, Vite variables, browser storage, logs, health responses, metrics labels, images, fixtures, source control, or release artifacts. Browser disclosure is request-scoped and memory-only. The only browser persistence exception is the integrity-bound public transaction recovery journal, which excludes payment data, auth secrets, signatures, and raw private material.

## Storage and access

- Encrypt payment values with managed AES-GCM key references. Bind ciphertext to purpose, owner, target, key version, and immutable lineage.
- Permit creation/revocation by the owner; disclosure only to the current order parties or an authorized operator. Revalidate wallet/session/role and current chain state at request time.
- Emit privacy-safe audit metadata for create, bind, disclose, revoke, purge, and denied attempts. Never log plaintext or encryption inputs.
- Keep session cookies HttpOnly/Secure/SameSite as deployed; keep rotating CSRF in memory and store only hashes server-side.
- Restrict database, backup, key-management, logs, and incident stores by least privilege. Separate key custody from application/operator roles.

## Retention

- Unbound references expire/revoke under the approved Q-6 policy.
- Bound order references become purge-eligible at the terminal order time plus the approved retention period; the implementation recommendation is 30 days, but Q-6 approval is mandatory before shared operation.
- The bounded retention worker is restart-safe, audit-producing, and fenced by canonical state. A rollback may adjust canonical lineage but must never resurrect purged ciphertext; retain an irreversible `DELETED` tombstone.
- Backups must honor the same classification, access, encryption, and deletion schedule. Document unavoidable backup expiry lag in Q-6 and test restore plus purge behavior.
- Public protocol/audit lineage may be retained for accounting and incident needs according to the approved policy, without private plaintext.

## Detection and containment

Trigger this procedure for plaintext in an unauthorized surface, suspicious disclosure, key/session compromise, broad database access, secret in an artifact, retention failure, or evidence of cross-wallet/cross-order access.

1. Set all automation modes `OFF`; drain the write fence. Pause the Diamond if custody risk exists.
2. Revoke affected sessions/workload credentials, disable disclosure, isolate logs/artifacts, and restrict database/key access. Do not destroy evidence.
3. Identify data categories, wallets/orders, time range, systems, recipients, key versions, backups, and whether plaintext left the trusted boundary.
4. Rotate affected session, encryption, cursor, raw-transaction, provider, or signer references using managed-key procedures. Never copy raw key material into a command or ticket.
5. Search source/build/image/log evidence using approved scanners without printing recovered secrets. Remove or quarantine artifacts and invalidate caches.
6. Preserve a privacy-safe timeline and access/audit records. Escalate to the named security/privacy owner and follow applicable notification/legal policy.

## Recovery and closure

Verify key rotation, session invalidation, ciphertext access controls, retention backlog, audit delivery, backups, clean bundle/image/privacy scans, and cross-wallet negative tests. Re-enable disclosure only after root-cause remediation and independent review. Resume automation through `SHADOW`; record affected Q-6 policy decisions and lessons learned.
