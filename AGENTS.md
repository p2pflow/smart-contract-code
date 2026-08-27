# P2PFlow Base Sepolia development guidance

- Target Base Sepolia only (`chainId 84532`).
- Use six-decimal mUSDC `0xa50e77Ae17F290Cfb0E2F29B4F2d9D0071Cb6D63`.
- The only privileged authorities are the Diamond owner/admin and the configured executor.
- The executor publishes the latest BUY/SELL prices and may assign one or more merchant/channel candidates with no small fixed protocol limit.
- Candidate assignment reserves nothing. The first eligible merchant acceptance wins and creates the only reservation.
- Keep custody, merchant/channel eligibility, current liquidity, reservations, party, order-state, deadlines, dispute and pause checks on-chain.
- Every active order phase has a protocol deadline. Permissionless expiry must be idempotent; the executor is its normal caller and recovery worker.
- SELL user mUSDC enters Diamond custody only when the first merchant accepts. An unfunded acceptance cancels without reserving channel INR.
- Completed SELL and cancelled accepted BUY orders are disputable for six hours. Disputes use neutral manual resolution only: no risk bucket, USDC award, protocol reserve or merchant debt.
- A disputed merchant is OFFLINE and blocked from new work, unstake and account/channel changes until all disputes are neutrally resolved.
- New merchants are ACTIVE and ONLINE immediately. Only payment channels require owner approval and every channel starts with zero fiat capacity.
- Keep deposited stake history separate from current merchant USDC liquidity.
- Do not add price history/rounds/quorum, assignment rounds, configuration versioning, or paginated on-chain registries.
- Merchant unstake requests require no outstanding reservations, accepted obligations or open disputes. Owner approval atomically returns all remaining current USDC to the merchant wallet.
- Never commit RPC credentials, private keys, Thirdweb secrets or Goldsky tokens.
- Keep payment/UPI details out of public storage, events and the subgraph.
- Preserve unrelated user work.
