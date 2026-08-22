#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd -- "$CONTRACT_ROOT/.." && pwd)"
ENV_FILE="${P2PFLOW_DEPLOY_ENV_FILE:-$CONTRACT_ROOT/.env}"
OUTPUT_DIR="${P2PFLOW_DEPLOY_OUTPUT_DIR:-$CONTRACT_ROOT/deployments/base-sepolia}"
MOCK_USDC="0xa50e77Ae17F290Cfb0E2F29B4F2d9D0071Cb6D63"

if ! command -v node >/dev/null 2>&1 && [[ -x /tmp/p2pflow-node/bin/node ]]; then
  export PATH="/tmp/p2pflow-node/bin:/usr/local/bin:/usr/bin:/bin"
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Node.js and npm are required. Expected Node 24.18.0 and npm 11.16.0.\n' >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'Missing deployment environment file: %s\n' "$ENV_FILE" >&2
  exit 1
fi

if [[ "$(realpath "$ENV_FILE")" == "$(realpath "$WORKSPACE_ROOT/.env")" ]]; then
  printf 'Refusing to read the prohibited workspace environment file.\n' >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -n "${P2PFLOW_RPC_OVERRIDE:-}" ]]; then
  BASE_SEPOLIA_RPC_URL="$P2PFLOW_RPC_OVERRIDE"
  export BASE_SEPOLIA_RPC_URL
fi

required=(BASE_SEPOLIA_RPC_URL DEPLOYER_PRIVATE_KEY)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Missing required variable: %s\n' "$name" >&2
    exit 1
  fi
done

if [[ ! "$DEPLOYER_PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  printf 'DEPLOYER_PRIVATE_KEY must be 0x followed by 64 hexadecimal characters.\n' >&2
  exit 1
fi

cd "$CONTRACT_ROOT"

deployer_address="$(node -e 'const { Wallet } = require("ethers"); process.stdout.write(new Wallet(process.env.DEPLOYER_PRIVATE_KEY).address)')"
printf 'Target chain: Base Sepolia (84532)\n'
printf 'Configured mUSDC: %s\n' "$MOCK_USDC"
printf 'Deployer: %s\n' "$deployer_address"
printf 'Output: %s\n' "$OUTPUT_DIR"

npm run compile
npm run deploy:base-sepolia:check -- --output "$OUTPUT_DIR"
npm run deploy:base-sepolia -- --output "$OUTPUT_DIR"

summary="$OUTPUT_DIR/deployment-summary.json"
manifest="$OUTPUT_DIR/deployment-manifest.json"
if [[ ! -f "$summary" || ! -f "$manifest" ]]; then
  printf 'Deployment finished without all expected output files.\n' >&2
  exit 1
fi

printf '\nDeployment complete. Address summary:\n'
node - "$summary" <<'NODE'
const fs = require("node:fs");
const summary = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`Diamond=${summary.diamond}`);
console.log(`DiamondInitV2=${summary.initializer}`);
console.log(`USDC=${summary.usdc}`);
for (const [name, address] of Object.entries(summary.facets)) console.log(`${name}=${address}`);
console.log(`DeploymentBlock=${summary.deploymentBlock}`);
console.log(`DeploymentTransaction=${summary.deploymentTransactionHash}`);
console.log(`InitializationTransaction=${summary.initializationTransactionHash}`);
NODE

printf '\nManifest: %s\n' "$manifest"
printf 'The Base Sepolia development Diamond is deployed and active.\n'
