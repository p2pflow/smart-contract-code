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
   - `kms-key-reference`
   - `database-secret-reference`
   - `redis-secret-reference`
4. Keep the five explicit live/canary gates in `deployment.yaml` false. A
   separate reviewed canary manifest is required after every gate in
   `docs/runbook.md` has evidence.
5. Add provider-specific workload identity outside this generic example. Do
   not mount a private key or place one in a Kubernetes Secret.
6. Add an environment-specific egress policy for DNS and the approved
   read-only shadow dependencies. This example does not guess provider IPs or
   open unrestricted egress rules.
7. Label only the approved monitoring pods with
   `p2pflow.network/operations-monitor=true`.

`Recreate` and one replica avoid implying that a distributed nonce lease or
multi-writer broadcaster has been approved. Horizontal scaling requires tested
fencing and queue/nonce ownership.

The expected runtime entrypoint is `dist/src/main.js`. It must wire concrete
adapters and start in shadow mode; the image is not operational until that
integration exists and readiness checks pass.
