import { encodeAbiParameters, encodeEventTopics, type AbiEvent } from "viem";
import { describe, expect, it } from "vitest";

import {
  decodeOrderCreated,
  DIAMOND_ABI,
  LOCAL_BASE_SEPOLIA_FIXTURE,
  ProtocolErrorCode,
} from "../src/index.js";

const event = DIAMOND_ABI.find((entry) => entry.type === "event" && entry.name === "OrderCreated") as AbiEvent;
const orderId = `0x${"11".repeat(32)}` as const;
const user = "0x2222222222222222222222222222222222222222" as const;
const transactionHash = `0x${"33".repeat(32)}` as const;

function orderCreatedLog() {
  const indexed = event.inputs.filter((input) => input.indexed);
  const nonIndexed = event.inputs.filter((input) => !input.indexed);
  const values: Record<string, bigint | string> = {
    orderId,
    user,
    orderType: 0n,
    usdcAmount: 2_000_000n,
    fiatAmount: 166_500_000n,
    price: 83_250_000n,
    createdAt: 1_700_000_000n,
    orderNumber: 42n,
  };
  return {
    address: LOCAL_BASE_SEPOLIA_FIXTURE.diamond.address,
    topics: encodeEventTopics({ abi: [event], eventName: "OrderCreated", args: Object.fromEntries(indexed.map((input) => [input.name, values[input.name]])) }),
    data: encodeAbiParameters(nonIndexed, nonIndexed.map((input) => values[input.name])),
  };
}

const options = {
  manifest: LOCAL_BASE_SEPOLIA_FIXTURE,
  diamondAbi: DIAMOND_ABI,
  runtime: "test" as const,
};

describe("receipt order ID decoding", () => {
  it("returns the emitted order ID and exact E6 values", () => {
    const decoded = decodeOrderCreated({ transactionHash, status: "success", logs: [orderCreatedLog()] }, options);
    expect(decoded).toMatchObject({
      orderId,
      user,
      orderType: 0,
      usdcAmount: 2_000_000n,
      fiatAmountE6: 166_500_000n,
      selectedPriceE6: 83_250_000n,
      createdAt: 1_700_000_000n,
      orderNumber: 42n,
      transactionHash,
    });
  });

  it("rejects transaction hashes, wrong-Diamond logs and ambiguous receipts", () => {
    expect(() => decodeOrderCreated(transactionHash, options)).toThrow(
      expect.objectContaining({ code: ProtocolErrorCode.INVALID_RECEIPT }),
    );
    expect(() =>
      decodeOrderCreated({ logs: [{ ...orderCreatedLog(), address: user }] }, options),
    ).toThrow(expect.objectContaining({ code: ProtocolErrorCode.ORDER_CREATED_NOT_FOUND }));
    expect(() => decodeOrderCreated({ logs: [orderCreatedLog(), orderCreatedLog()] }, options)).toThrow(
      expect.objectContaining({ code: ProtocolErrorCode.ORDER_CREATED_AMBIGUOUS }),
    );
  });
});
