import { describe, expect, it } from "vitest";

import {
  assertManifestRuntime,
  BASE_SEPOLIA_CHAIN_ID,
  LOCAL_BASE_SEPOLIA_FIXTURE,
  OFFICIAL_BASE_SEPOLIA_USDC_ADDRESS,
  parseDeploymentManifest,
  ProtocolErrorCode,
} from "../src/index.js";

describe("deployment manifest schema", () => {
  it("accepts only the deterministic local Base Sepolia fixture", () => {
    const parsed = parseDeploymentManifest(LOCAL_BASE_SEPOLIA_FIXTURE);
    expect(parsed.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
    expect(parsed.usdc.address).toBe(OFFICIAL_BASE_SEPOLIA_USDC_ADDRESS);
    expect(parsed.usdc.decimals).toBe(6);
    expect(parsed.kind).toBe("local-test-fixture");
    expect(parsed.safeForSharedEnvironment).toBe(false);
    expect(() => assertManifestRuntime(parsed, "test")).not.toThrow();
  });

  it("rejects schema, chain, token and digest drift", () => {
    expect(() => parseDeploymentManifest({ ...LOCAL_BASE_SEPOLIA_FIXTURE, chainId: 1 })).toThrow();
    expect(() =>
      parseDeploymentManifest({
        ...LOCAL_BASE_SEPOLIA_FIXTURE,
        usdc: { ...LOCAL_BASE_SEPOLIA_FIXTURE.usdc, address: "0x0000000000000000000000000000000000000001" },
      }),
    ).toThrow();
    expect(() =>
      parseDeploymentManifest({ ...LOCAL_BASE_SEPOLIA_FIXTURE, network: "changed-without-new-digest" }),
    ).toThrow(expect.objectContaining({ code: ProtocolErrorCode.MANIFEST_DIGEST_MISMATCH }));
  });

  it("fails closed outside local and test runtimes", () => {
    for (const runtime of ["base-sepolia", "shared", "production"] as const) {
      expect(() => assertManifestRuntime(LOCAL_BASE_SEPOLIA_FIXTURE, runtime)).toThrow(
        expect.objectContaining({ code: ProtocolErrorCode.MANIFEST_FIXTURE_FORBIDDEN }),
      );
    }
  });
});
