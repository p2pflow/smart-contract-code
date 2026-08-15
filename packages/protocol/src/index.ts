import type { Abi } from "viem";

import { sha256Canonical, parseDeploymentManifest } from "./manifest.js";
import {
  GENERATED_DIAMOND_ABI,
  GENERATED_LOCAL_BASE_SEPOLIA_FIXTURE,
  GENERATED_PROTOCOL_ARTIFACT,
  GENERATED_USDC_ABI,
} from "./generated/artifacts.js";

export * from "./amounts.js";
export * from "./calls.js";
export * from "./constants.js";
export * from "./errors.js";
export * from "./manifest.js";
export * from "./receipt.js";
export * from "./statuses.js";

export const DIAMOND_ABI = GENERATED_DIAMOND_ABI as Abi;
export const USDC_ABI = GENERATED_USDC_ABI as Abi;
export const LOCAL_BASE_SEPOLIA_FIXTURE = parseDeploymentManifest(GENERATED_LOCAL_BASE_SEPOLIA_FIXTURE);
export const PROTOCOL_ARTIFACT = Object.freeze(GENERATED_PROTOCOL_ARTIFACT);
export const PROTOCOL_ARTIFACT_DIGEST = GENERATED_PROTOCOL_ARTIFACT.protocolArtifactDigest;

if (sha256Canonical(DIAMOND_ABI).toLowerCase() !== LOCAL_BASE_SEPOLIA_FIXTURE.abiSha256.toLowerCase()) {
  throw new Error("Generated Diamond ABI digest does not match the local fixture manifest");
}
