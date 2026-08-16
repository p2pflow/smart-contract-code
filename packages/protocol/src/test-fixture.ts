import type { Abi } from "viem";
import { z } from "zod";

import { GENERATED_DIAMOND_ABI } from "./generated/artifacts.js";
import { GENERATED_LOCAL_BASE_SEPOLIA_FIXTURE } from "./generated/test-fixture.js";
import { ProtocolError, ProtocolErrorCode } from "./errors.js";
import {
  DeploymentManifestShapeSchema,
  assertDiamondAbi,
  assertManifestShapeSemantics,
  manifestDigestInput,
  parseDeploymentManifest,
  sha256Canonical,
  type DeploymentManifest,
  type ManifestRuntime,
} from "./manifest.js";

const LocalDeploymentManifestSchema = DeploymentManifestShapeSchema.extend({
  kind: z.literal(GENERATED_LOCAL_BASE_SEPOLIA_FIXTURE.kind),
}).strict();

export type LocalDeploymentManifest = z.infer<typeof LocalDeploymentManifestSchema>;

function isZero(value: string): boolean {
  return /^0x0+$/iu.test(value);
}

function assertLocalFixtureSemantics(manifest: LocalDeploymentManifest): void {
  if (
    manifest.network !== "base-sepolia-local-v2-non-deployed" ||
    manifest.deployed || manifest.safeForSharedEnvironment || manifest.initialization.initialized ||
    !isZero(manifest.diamond.deploymentTransactionHash) || manifest.diamond.deploymentBlock !== 0 ||
    manifest.diamond.startBlock !== 0 || !isZero(manifest.initialization.transactionHash) ||
    manifest.initialization.block !== 0 || !isZero(manifest.usdc.codeHash)
  ) {
    throw new ProtocolError(
      ProtocolErrorCode.MANIFEST_INVALID,
      "Local fixture must remain conspicuously non-deployed and non-shared",
    );
  }
}

export function parseTestDeploymentManifest(value: unknown): LocalDeploymentManifest {
  const parsed = LocalDeploymentManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_INVALID, parsed.error.issues[0]?.message);
  }
  const manifest = parsed.data;
  assertManifestShapeSemantics(manifest);
  assertLocalFixtureSemantics(manifest);
  if (sha256Canonical(manifestDigestInput(manifest)).toLowerCase() !== manifest.manifestSha256.toLowerCase()) {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_DIGEST_MISMATCH);
  }
  return manifest;
}

export function assertTestManifestRuntime(
  manifestValue: unknown,
  runtime: ManifestRuntime,
): LocalDeploymentManifest {
  const manifest = parseTestDeploymentManifest(manifestValue);
  if (runtime !== "local" && runtime !== "test") {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_FIXTURE_FORBIDDEN);
  }
  return manifest;
}

export function assertTestProtocolBoundary(
  manifestValue: unknown,
  abi: Abi,
  runtime: ManifestRuntime,
): LocalDeploymentManifest {
  const manifest = assertTestManifestRuntime(manifestValue, runtime);
  assertDiamondAbi(manifest, abi);
  return manifest;
}

export const LOCAL_BASE_SEPOLIA_FIXTURE = assertTestProtocolBoundary(
  GENERATED_LOCAL_BASE_SEPOLIA_FIXTURE,
  GENERATED_DIAMOND_ABI as Abi,
  "test",
);

const syntheticDeploymentInput = {
  ...LOCAL_BASE_SEPOLIA_FIXTURE,
  kind: "base-sepolia-deployment",
  network: "base-sepolia",
  deployed: true,
  safeForSharedEnvironment: true,
  diamond: {
    ...LOCAL_BASE_SEPOLIA_FIXTURE.diamond,
    deploymentTransactionHash: `0x${"11".repeat(32)}`,
    deploymentBlock: 1,
    startBlock: 1,
  },
  initialization: {
    ...LOCAL_BASE_SEPOLIA_FIXTURE.initialization,
    initialized: true,
    transactionHash: `0x${"22".repeat(32)}`,
    block: 2,
  },
  usdc: {
    ...LOCAL_BASE_SEPOLIA_FIXTURE.usdc,
    codeHash: `0x${"33".repeat(32)}`,
  },
};
const { manifestSha256: _fixtureDigest, ...unsignedSyntheticDeployment } = syntheticDeploymentInput;

export const TEST_BASE_SEPOLIA_DEPLOYMENT: DeploymentManifest = parseDeploymentManifest({
  ...unsignedSyntheticDeployment,
  manifestSha256: sha256Canonical(unsignedSyntheticDeployment),
});
