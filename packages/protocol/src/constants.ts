export const PACKAGE_NAME = "@p2pflow/protocol" as const;
export const PACKAGE_VERSION = "2.0.0-local.2" as const;
export const MANIFEST_SCHEMA_VERSION = "2.0.0" as const;

export const ONCHAIN_PROTOCOL_ID =
  "0xee34f489349fbe024aa70447b08f85e9becad4ffc266742cb4d76dfc294aacc5" as const;
export const ONCHAIN_PROTOCOL_VERSION = 2 as const;
export const STORAGE_LAYOUT_VERSION = 2 as const;
export const STORAGE_NAMESPACE =
  "0x8eda5a1d6c0dccefe0e030b73e1a1aaa2a90d7a9ed72f2505f70c49e1b3fa545" as const;

export const BASE_SEPOLIA_CHAIN_ID = 84_532 as const;
export const BASE_SEPOLIA_NETWORK = "base-sepolia" as const;
export const OFFICIAL_BASE_SEPOLIA_USDC_ADDRESS =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const USDC_DECIMALS = 6 as const;
export const E6 = 1_000_000n;
export const BPS_DENOMINATOR = 10_000n;
export const MAX_UINT256 = (1n << 256n) - 1n;

export const DIAMOND_FACET_NAMES = Object.freeze([
  "AccessControlFacet",
  "AssignmentFacet",
  "ConfigFacet",
  "DiamondCutFacet",
  "DiamondLoupeFacet",
  "DisputeFacet",
  "MerchantFacet",
  "OrderFacet",
  "OwnershipFacet",
  "PricingFacet",
] as const);

export const PROTOCOL_ROLE_NAMES = Object.freeze([
  "DEFAULT_ADMIN_ROLE",
  "OPERATOR_ROLE",
  "UPGRADER_ROLE",
  "PAUSER_ROLE",
  "PRICE_UPDATER_ROLE",
  "ORDER_ASSIGNER_ROLE",
  "DISPUTE_RESOLVER_ROLE",
] as const);

export const EXPECTED_SELECTOR_COUNT = 76 as const;
export const EXPECTED_EVENT_COUNT = 39 as const;
export const EXPECTED_ERROR_COUNT = 70 as const;

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type Bytes32 = `0x${string}`;
