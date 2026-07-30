# Kubernetes deployment example

These manifests are a non-production, shadow-only example. They do not create
or claim a chain deployment, RPC/subgraph service, database, Redis instance,
KMS/HSM key, workload identity, or secret value.

Before rendering the example:

1. Replace the deliberately non-resolving image reference with a reviewed
   immutable digest.
2. Create `order-helper-reviewed-config` through the approved configuration
   pipeline. It must contain the required non-secret names from
   `.env.example`, with Base Sepolia-only identity and signed risk values.
3. Create `order-helper-runtime-secrets` through the external secret operator.
   It exposes only these keys to the pod:
   - `primary-rpc-url`
   - `fallback-rpc-url`
   - `database-secret-reference`
   - `redis-secret-reference`
4. Keep the pinned REJECT and live/send/verified/canary values exactly as shown.
   No canary manifest is authorized. A distinct later implementation requires
   all 14 ordered reconsideration gates and a new Council PASS.
5. Use provider-specific workload identity only for approved read-only
   dependencies. Do not mount a private key, inject a KMS signing reference,
   or place either in a Kubernetes Secret.
6. Keep the checked-in deny-all egress policy with this exact scaffold. The
   shipped runtime wires no RPC, subgraph, database, Redis, mailbox, signer,
   or broadcaster adapter, so it requires no outbound network access. A later
   environment-specific read-only integration must replace the deny-all rule
   with narrowly reviewed DNS and dependency destinations; this manifest does
   not guess provider IPs or open unrestricted egress.
7. Label only the approved monitoring pods with
   `p2pflow.network/operations-monitor=true`.

`Recreate` and one replica avoid implying that a distributed nonce lease or
multi-writer broadcaster has been approved. Horizontal scaling requires tested
fencing and queue/nonce ownership.

The entrypoint is `dist/src/main.js`; it is intentionally unready and wires no
external adapters. A distinct read-only integration must be built and reviewed
before readiness can pass.
