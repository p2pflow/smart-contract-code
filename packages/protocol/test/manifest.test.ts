import { describe, expect, it } from "vitest";

import {
  assertProtocolBoundary,
  BASE_SEPOLIA_CHAIN_ID,
  DIAMOND_ABI,
  DIAMOND_FACET_NAMES,
  OFFICIAL_BASE_SEPOLIA_USDC_ADDRESS,
  ONCHAIN_PROTOCOL_ID,
  ONCHAIN_PROTOCOL_VERSION,
  PACKAGE_VERSION,
  parseDeploymentManifest,
  PROTOCOL_ROLE_NAMES,
  ProtocolErrorCode,
  sha256Canonical,
  STORAGE_LAYOUT_VERSION,
} from "../src/index.js";
import {
  LOCAL_BASE_SEPOLIA_FIXTURE,
  TEST_BASE_SEPOLIA_DEPLOYMENT,
  assertTestManifestRuntime,
  assertTestProtocolBoundary,
  parseTestDeploymentManifest,
} from "../src/test-fixture.js";

function resign(value: Record<string, unknown>) {
  const { manifestSha256: _old, ...unsigned } = value;
  return { ...unsigned, manifestSha256: sha256Canonical(unsigned) };
}

describe("deployment manifest schema", () => {
  it("locks independent package, on-chain, layout, facet, owner and role identities", () => {
    const parsed = parseTestDeploymentManifest(LOCAL_BASE_SEPOLIA_FIXTURE);
    expect(parsed.packageVersion).toBe(PACKAGE_VERSION);
    expect(parsed.protocolId).toBe(ONCHAIN_PROTOCOL_ID);
    expect(parsed.protocolVersion).toBe(ONCHAIN_PROTOCOL_VERSION);
    expect(parsed.layoutVersion).toBe(STORAGE_LAYOUT_VERSION);
    expect(parsed.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
    expect(parsed.usdc.address).toBe(OFFICIAL_BASE_SEPOLIA_USDC_ADDRESS);
    expect(parsed.facets.map(({ name }) => name)).toEqual(DIAMOND_FACET_NAMES);
    expect(Object.keys(parsed.roles)).toEqual(PROTOCOL_ROLE_NAMES);
    expect(new Set([
      parsed.diamond.owner,
      ...Object.values(parsed.roles).map(({ expectedAddress }) => expectedAddress),
    ]).size).toBe(8);
    expect(parsed.kind).toBe("local-test-fixture");
    expect(parsed.deployed).toBe(false);
    expect(parsed.initialization.initialized).toBe(false);
    expect(parsed.safeForSharedEnvironment).toBe(false);
    expect(() => assertTestProtocolBoundary(parsed, DIAMOND_ABI, "test")).not.toThrow();
    expect(() => parseDeploymentManifest(LOCAL_BASE_SEPOLIA_FIXTURE)).toThrow(
      expect.objectContaining({ code: ProtocolErrorCode.MANIFEST_INVALID }),
    );
    expect(() => assertProtocolBoundary(TEST_BASE_SEPOLIA_DEPLOYMENT, DIAMOND_ABI, "test")).not.toThrow();
  });

  it("rejects schema, chain, token, digest, facet, role and deployment-proof drift", () => {
    expect(() => parseTestDeploymentManifest({ ...LOCAL_BASE_SEPOLIA_FIXTURE, chainId: 1 })).toThrow();
    expect(() => parseTestDeploymentManifest(resign({
      ...LOCAL_BASE_SEPOLIA_FIXTURE,
      usdc: { ...LOCAL_BASE_SEPOLIA_FIXTURE.usdc, address: "0x0000000000000000000000000000000000000001" },
    }))).toThrow(expect.objectContaining({ code: ProtocolErrorCode.MANIFEST_INVALID }));
    expect(() => parseTestDeploymentManifest({
      ...LOCAL_BASE_SEPOLIA_FIXTURE,
      createdAt: "1970-01-02T00:00:00.000Z",
    })).toThrow(expect.objectContaining({ code: ProtocolErrorCode.MANIFEST_DIGEST_MISMATCH }));
    expect(() => parseTestDeploymentManifest(resign({
      ...LOCAL_BASE_SEPOLIA_FIXTURE,
      facets: LOCAL_BASE_SEPOLIA_FIXTURE.facets.slice(1),
    }))).toThrow(expect.objectContaining({ code: ProtocolErrorCode.MANIFEST_INVALID }));
    expect(() => parseTestDeploymentManifest(resign({
      ...LOCAL_BASE_SEPOLIA_FIXTURE,
      roles: {
        ...LOCAL_BASE_SEPOLIA_FIXTURE.roles,
        OPERATOR_ROLE: {
          ...LOCAL_BASE_SEPOLIA_FIXTURE.roles.OPERATOR_ROLE,
          expectedAddress: LOCAL_BASE_SEPOLIA_FIXTURE.diamond.owner,
        },
      },
    }))).toThrow(expect.objectContaining({ code: ProtocolErrorCode.MANIFEST_INVALID }));
    expect(() => parseTestDeploymentManifest(resign({
      ...LOCAL_BASE_SEPOLIA_FIXTURE,
      deployed: true,
      safeForSharedEnvironment: true,
    }))).toThrow(expect.objectContaining({ code: ProtocolErrorCode.MANIFEST_INVALID }));
  });

  it("fails closed outside local/test and rejects any supplied ABI drift", () => {
    for (const runtime of ["base-sepolia", "shared", "production"] as const) {
      expect(() => assertTestManifestRuntime(LOCAL_BASE_SEPOLIA_FIXTURE, runtime)).toThrow(
        expect.objectContaining({ code: ProtocolErrorCode.MANIFEST_FIXTURE_FORBIDDEN }),
      );
    }
    const drifted = DIAMOND_ABI.slice(1);
    expect(() => assertTestProtocolBoundary(LOCAL_BASE_SEPOLIA_FIXTURE, drifted, "test")).toThrow(
      expect.objectContaining({ code: ProtocolErrorCode.ABI_DIGEST_MISMATCH }),
    );
  });
});
