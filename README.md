# P2PFlow smart contract

Simplified EIP-2535 Diamond for Base Sepolia development.

## Authority

- Diamond owner: administration, merchant/channel review, disputes, pause, and upgrades.
- Executor: assigns one merchant/channel to each order and publishes the latest BUY/SELL prices.

There are no application role sets, assignment rounds, price rounds/history/quorum, protocol timeouts, configuration versions, or paginated on-chain registries.

## Base Sepolia deployment

The development token is mUSDC at `0xa50e77Ae17F290Cfb0E2F29B4F2d9D0071Cb6D63`.

Configure `.env`:

```dotenv
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
DEPLOYER_PRIVATE_KEY=0x...
P2PFLOW_EXECUTOR_ADDR=0x...
P2PFLOW_MIN_MERCHANT_STAKE_USDC_ATOMS=100000000
```

Then run:

```sh
npm run deploy:base-sepolia:mock
```

The script checks chain ID 84532 and the six-decimal mUSDC contract, compiles all facets, deploys and initializes the Diamond, unpauses it, and writes the addresses to `deployments/base-sepolia/`.

## Local checks

```sh
npm run compile
npm test
```

Never commit RPC credentials or private keys.
