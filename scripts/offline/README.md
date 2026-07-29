# OFFLINE / NO AUTHORITY / NO TRANSACTIONS

This directory contains pure, transaction-disabled scaffolding admitted by the
2026-07-29 Council bill after its unanimous `REJECT` verdict.

The code here:

- performs deterministic `BigInt` formula and golden-vector calculations only;
- does not import Hardhat, ethers, an RPC client, a wallet, or a signer;
- does not read environment variables or private keys;
- cannot construct calldata, authorize a sweep, move value, deploy, initialize,
  migrate, or execute a Diamond cut; and
- is not a production accounting, allocation, reconciliation, or policy
  implementation.

`primitives.js` uses runtime unit tags to prevent accidental addition or
substitution of USDC atoms, micro-INR, price, rail, and virtual-finish values.
Its decision-envelope hash is a non-authoritative SHA-256 replay scaffold, not
EIP-712 and not a signing or on-chain encoding.
