export const PACKAGE_NAME = "@p2pflow/protocol" as const;
export const PROTOCOL_VERSION = "0.1.0-local.2" as const;
export const MANIFEST_SCHEMA_VERSION = "1.0.0" as const;

export const BASE_SEPOLIA_CHAIN_ID = 84_532 as const;
export const BASE_SEPOLIA_NETWORK = "base-sepolia" as const;
export const OFFICIAL_BASE_SEPOLIA_USDC_ADDRESS =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const USDC_DECIMALS = 6 as const;
export const E6 = 1_000_000n;
export const BPS_DENOMINATOR = 10_000n;

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type Bytes32 = `0x${string}`;
