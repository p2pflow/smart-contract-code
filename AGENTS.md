# P2PFlow Base Sepolia development guidance

- Target Base Sepolia only (`chainId 84532`).
- Use six-decimal mUSDC `0xa50e77Ae17F290Cfb0E2F29B4F2d9D0071Cb6D63`.
- The only privileged authorities are the Diamond owner/admin and the configured executor.
- The executor may publish the latest BUY/SELL prices and assign one merchant/channel to a created order.
- Keep custody, merchant/channel eligibility, liquidity/capacity, party, order-state, and pause checks on-chain.
- Do not add price history/rounds/quorum, assignment rounds/candidate storage, protocol timeouts, configuration versioning, or paginated on-chain registries.
- Merchant unstake requests require no outstanding obligations. Owner approval atomically returns all stake and idle liquidity to the merchant wallet.
- Never commit RPC credentials, private keys, Thirdweb secrets, or Goldsky tokens.
- Keep payment/UPI details out of public storage, events, and the subgraph.
- Preserve unrelated user work.
