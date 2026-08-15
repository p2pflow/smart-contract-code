import { sha256, stringToHex } from "viem";
import { z } from "zod";

import {
  BASE_SEPOLIA_CHAIN_ID,
  MANIFEST_SCHEMA_VERSION,
  OFFICIAL_BASE_SEPOLIA_USDC_ADDRESS,
  PROTOCOL_VERSION,
  USDC_DECIMALS,
  type Hex,
} from "./constants.js";
import { ProtocolError, ProtocolErrorCode } from "./errors.js";

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/u;

const AddressSchema = z.string().regex(addressPattern);
const Bytes32Schema = z.string().regex(bytes32Pattern);

export const DeploymentManifestSchema = z
  .object({
    schemaVersion: z.string().min(1),
    protocolVersion: z.string().min(1),
    kind: z.enum(["local-test-fixture", "base-sepolia-deployment"]),
    safeForSharedEnvironment: z.boolean(),
    chainId: z.literal(BASE_SEPOLIA_CHAIN_ID),
    network: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    diamond: z.object({
      address: AddressSchema,
      deploymentTransactionHash: Bytes32Schema,
      deploymentBlock: z.number().int().nonnegative(),
      startBlock: z.number().int().nonnegative(),
    }),
    usdc: z.object({
      address: AddressSchema,
      decimals: z.literal(USDC_DECIMALS),
    }),
    facets: z.array(
      z.object({
        name: z.string().min(1),
        address: AddressSchema,
        codeHash: Bytes32Schema,
        functionSelectors: z.array(z.string().regex(/^0x[0-9a-fA-F]{8}$/u)),
      }),
    ),
    roles: z.record(
      z.string(),
      z.object({ id: Bytes32Schema, expectedAddress: AddressSchema }),
    ),
    abiSha256: Bytes32Schema,
    manifestSha256: Bytes32Schema,
  })
  .strict();

export type DeploymentManifest = z.infer<typeof DeploymentManifestSchema>;
export type ManifestRuntime = "local" | "test" | "base-sepolia" | "shared" | "production";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value: unknown): Hex {
  return sha256(stringToHex(stableStringify(value)));
}

export function manifestDigestInput(manifest: DeploymentManifest): Omit<DeploymentManifest, "manifestSha256"> {
  const { manifestSha256: _digest, ...input } = manifest;
  return input;
}

export function parseDeploymentManifest(value: unknown): DeploymentManifest {
  const parsed = DeploymentManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_INVALID, parsed.error.issues[0]?.message);
  }
  const manifest = parsed.data;
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || manifest.protocolVersion !== PROTOCOL_VERSION) {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_INVALID, "Unsupported manifest or protocol version");
  }
  if (manifest.usdc.address.toLowerCase() !== OFFICIAL_BASE_SEPOLIA_USDC_ADDRESS.toLowerCase()) {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_INVALID, "Manifest must use official Base Sepolia USDC");
  }
  const calculated = sha256Canonical(manifestDigestInput(manifest));
  if (calculated.toLowerCase() !== manifest.manifestSha256.toLowerCase()) {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_DIGEST_MISMATCH);
  }
  return manifest;
}

export function assertManifestRuntime(manifest: DeploymentManifest, runtime: ManifestRuntime): void {
  if (manifest.kind === "local-test-fixture" && runtime !== "local" && runtime !== "test") {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_FIXTURE_FORBIDDEN);
  }
  if (runtime !== "local" && runtime !== "test" && !manifest.safeForSharedEnvironment) {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_FIXTURE_FORBIDDEN);
  }
}
