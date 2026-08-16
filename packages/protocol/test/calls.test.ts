import { describe, expect, it } from "vitest";

import {
  BASE_SEPOLIA_CHAIN_ID,
  createProtocolCallFactory,
  DIAMOND_ABI,
  ONCHAIN_PROTOCOL_VERSION,
  PACKAGE_VERSION,
  ProtocolErrorCode,
  USDC_ABI,
} from "../src/index.js";
import { TEST_BASE_SEPOLIA_DEPLOYMENT } from "../src/test-fixture.js";

const input = {
  manifest: TEST_BASE_SEPOLIA_DEPLOYMENT,
  diamondAbi: DIAMOND_ABI,
  usdcAbi: USDC_ABI,
  runtime: "test" as const,
};

describe("ABI-bound prepared protocol calls", () => {
  it("prepares immutable canonical v2 Diamond and official-USDC calls", () => {
    const calls = createProtocolCallFactory(input);
    const orderId = `0x${"11".repeat(32)}` as const;
    const markSent = calls.diamond("markFiatSent", [orderId] as const);
    expect(markSent).toMatchObject({
      chainId: BASE_SEPOLIA_CHAIN_ID,
      contract: "diamond",
      address: TEST_BASE_SEPOLIA_DEPLOYMENT.diamond.address,
      functionName: "markFiatSent",
      args: [orderId],
      value: 0n,
      packageVersion: PACKAGE_VERSION,
      protocolVersion: ONCHAIN_PROTOCOL_VERSION,
    });
    const create = calls.diamond("createBuyOrder", [1_000_000n, 7n, 95_000_000n, 1_700_000_000n] as const);
    expect(create.functionName).toBe("createBuyOrder");
    const expire = calls.diamond("expireAssignment", [orderId, 4n] as const);
    expect(expire.args).toEqual([orderId, 4n]);
    const approve = calls.usdc("approve", [TEST_BASE_SEPOLIA_DEPLOYMENT.diamond.address, 1_000_000n] as const);
    expect(approve.address).toBe(TEST_BASE_SEPOLIA_DEPLOYMENT.usdc.address);
    expect(Object.isFrozen(approve)).toBe(true);
    expect(Object.isFrozen(approve.args)).toBe(true);
  });

  it("rejects legacy/unknown names, wrong argument shapes and both ABI digest drifts", () => {
    const calls = createProtocolCallFactory(input);
    expect(() => calls.diamond("markPaymentSent" as never, [] as never)).toThrow(
      expect.objectContaining({ code: ProtocolErrorCode.VALIDATION_FAILED }),
    );
    expect(() => calls.diamond("markFiatSent", [] as never)).toThrow(
      expect.objectContaining({ code: ProtocolErrorCode.VALIDATION_FAILED }),
    );
    expect(() => calls.diamond("markFiatSent", ["not-bytes32"] as never)).toThrow(
      expect.objectContaining({ code: ProtocolErrorCode.VALIDATION_FAILED }),
    );
    expect(() => createProtocolCallFactory({ ...input, diamondAbi: DIAMOND_ABI.slice(1) })).toThrow(
      expect.objectContaining({ code: ProtocolErrorCode.ABI_DIGEST_MISMATCH }),
    );
    expect(() => createProtocolCallFactory({ ...input, usdcAbi: USDC_ABI.slice(1) })).toThrow(
      expect.objectContaining({ code: ProtocolErrorCode.ABI_DIGEST_MISMATCH }),
    );
  });
});
