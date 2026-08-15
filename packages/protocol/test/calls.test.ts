import { describe, expect, it } from "vitest";

import {
  BASE_SEPOLIA_CHAIN_ID,
  createProtocolCallFactory,
  DIAMOND_ABI,
  LOCAL_BASE_SEPOLIA_FIXTURE,
  PROTOCOL_VERSION,
  USDC_ABI,
} from "../src/index.js";

describe("prepared protocol calls", () => {
  it("prepares immutable Diamond and official-USDC call contracts", () => {
    const calls = createProtocolCallFactory({
      manifest: LOCAL_BASE_SEPOLIA_FIXTURE,
      diamondAbi: DIAMOND_ABI,
      usdcAbi: USDC_ABI,
      runtime: "test",
    });
    const orderId = `0x${"11".repeat(32)}` as const;
    const markSent = calls.diamond("markPaymentSent", [orderId] as const);
    expect(markSent).toMatchObject({
      chainId: BASE_SEPOLIA_CHAIN_ID,
      contract: "diamond",
      address: LOCAL_BASE_SEPOLIA_FIXTURE.diamond.address,
      functionName: "markPaymentSent",
      args: [orderId],
      value: 0n,
      protocolVersion: PROTOCOL_VERSION,
    });
    const approve = calls.usdc("approve", [LOCAL_BASE_SEPOLIA_FIXTURE.diamond.address, 1_000_000n] as const);
    expect(approve.address).toBe(LOCAL_BASE_SEPOLIA_FIXTURE.usdc.address);
    expect(Object.isFrozen(approve)).toBe(true);
    expect(Object.isFrozen(approve.args)).toBe(true);
  });
});
