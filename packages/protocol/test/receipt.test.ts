import { encodeAbiParameters, encodeEventTopics, type Abi, type AbiEvent } from "viem";
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

function orderCreatedLog(overrides: Record<string, bigint | string> = {}) {
  const indexed = event.inputs.filter((input) => input.indexed);
  const nonIndexed = event.inputs.filter((input) => !input.indexed);
  const values: Record<string, bigint | string> = {
    orderId,
    user,
    orderType: 0n,
    usdcAmount: 2_000_000n,
    fiatAmountE6: 166_500_000n,
    selectedPriceE6: 83_250_000n,
    roundId: 7n,
    deadline: 1_700_000_600n,
    createdAt: 1_700_000_000n,
    orderNumber: 42n,
    ...overrides,
  };
  return {
    address: LOCAL_BASE_SEPOLIA_FIXTURE.diamond.address,
    topics: encodeEventTopics({
      abi: [event],
      eventName: "OrderCreated",
      args: Object.fromEntries(indexed.map((input) => [input.name, values[input.name]!])),
    }),
    data: encodeAbiParameters(nonIndexed, nonIndexed.map((input) => values[input.name]!)),
  };
}

const options = {
  manifest: LOCAL_BASE_SEPOLIA_FIXTURE,
  diamondAbi: DIAMOND_ABI,
  runtime: "test" as const,
};

describe("strict v2 receipt order ID decoding", () => {
  it("returns all mandatory canonical fields from one successful Diamond event", () => {
    const decoded = decodeOrderCreated({ transactionHash, status: "success", logs: [orderCreatedLog()] }, options);
    expect(decoded).toEqual({
      orderId,
      user,
      orderType: 0,
      usdcAmount: 2_000_000n,
      fiatAmountE6: 166_500_000n,
      selectedPriceE6: 83_250_000n,
      roundId: 7n,
      deadline: 1_700_000_600n,
      createdAt: 1_700_000_000n,
      orderNumber: 42n,
      transactionHash,
    });
  });

  it("rejects hashes, failed/missing-status receipts, missing hashes and malformed fields", () => {
    expect(() => decodeOrderCreated(transactionHash, options)).toThrow(
      expect.objectContaining({ code: ProtocolErrorCode.INVALID_RECEIPT }),
    );
    expect(() => decodeOrderCreated({ transactionHash, status: "reverted", logs: [orderCreatedLog()] }, options))
      .toThrow(expect.objectContaining({ code: ProtocolErrorCode.INVALID_RECEIPT }));
    expect(() => decodeOrderCreated({ transactionHash, logs: [orderCreatedLog()] }, options))
      .toThrow(expect.objectContaining({ code: ProtocolErrorCode.INVALID_RECEIPT }));
    expect(() => decodeOrderCreated({ status: "success", logs: [orderCreatedLog()] }, options))
      .toThrow(expect.objectContaining({ code: ProtocolErrorCode.INVALID_RECEIPT }));
    expect(() => decodeOrderCreated({
      transactionHash, status: "success", logs: [orderCreatedLog({ orderId: `0x${"00".repeat(32)}` })],
    }, options)).toThrow(expect.objectContaining({ code: ProtocolErrorCode.INVALID_RECEIPT }));
    expect(() => decodeOrderCreated({
      transactionHash, status: "success", logs: [orderCreatedLog({ orderType: 2n })],
    }, options)).toThrow(expect.objectContaining({ code: ProtocolErrorCode.INVALID_RECEIPT }));
  });

  it("rejects wrong-Diamond, missing, ambiguous, truncated and legacy-shaped logs", () => {
    expect(() => decodeOrderCreated({
      transactionHash, status: 1, logs: [{ ...orderCreatedLog(), address: user }],
    }, options)).toThrow(expect.objectContaining({ code: ProtocolErrorCode.ORDER_CREATED_NOT_FOUND }));
    expect(() => decodeOrderCreated({
      transactionHash, status: 1n, logs: [orderCreatedLog(), orderCreatedLog()],
    }, options)).toThrow(expect.objectContaining({ code: ProtocolErrorCode.ORDER_CREATED_AMBIGUOUS }));
    const truncated = { ...orderCreatedLog(), data: "0x" as const };
    expect(() => decodeOrderCreated({ transactionHash, status: "0x1", logs: [truncated] }, options))
      .toThrow(expect.objectContaining({ code: ProtocolErrorCode.ORDER_CREATED_NOT_FOUND }));

    const oldEvent = [{
      type: "event",
      name: "OrderCreated",
      inputs: [
        { name: "orderId", type: "bytes32", indexed: true },
        { name: "user", type: "address", indexed: true },
        { name: "fiatAmount", type: "uint256", indexed: false },
        { name: "price", type: "uint256", indexed: false },
      ],
    }] as const satisfies Abi;
    const old = oldEvent[0] as AbiEvent;
    const legacyLog = {
      address: LOCAL_BASE_SEPOLIA_FIXTURE.diamond.address,
      topics: encodeEventTopics({ abi: oldEvent, eventName: "OrderCreated", args: { orderId, user } }),
      data: encodeAbiParameters(old.inputs.filter((input) => !input.indexed), [1n, 1n]),
    };
    expect(() => decodeOrderCreated({ transactionHash, status: 1, logs: [legacyLog] }, options))
      .toThrow(expect.objectContaining({ code: ProtocolErrorCode.ORDER_CREATED_NOT_FOUND }));
  });
});
