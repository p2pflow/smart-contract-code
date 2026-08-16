import fs from "node:fs";

import { encodeErrorResult } from "viem";
import { describe, expect, it } from "vitest";

import {
  CandidateStatus,
  ChannelAvailability,
  ChannelStatus,
  CONTRACT_ERROR_SELECTORS,
  DIAMOND_ABI,
  DisputeResolution,
  DisputeStatus,
  EXPECTED_ERROR_COUNT,
  EXPECTED_EVENT_COUNT,
  EXPECTED_SELECTOR_COUNT,
  mapProtocolError,
  MerchantAvailability,
  MerchantStatus,
  OrderStatus,
  OrderType,
  PublicationKind,
  ProtocolErrorCode,
  SideMask,
} from "../src/index.js";
import { LOCAL_BASE_SEPOLIA_FIXTURE } from "../src/test-fixture.js";

describe("frozen v2 ABI/status/error surface", () => {
  it("keeps the local manifest behind the explicit test-only package entry", async () => {
    const production = await import("../dist/index.js");
    const testFixture = await import("@p2pflow/protocol/test-fixture");
    const productionSources = [
      "../dist/index.js",
      "../dist/manifest.js",
      "../dist/generated/artifacts.js",
    ].map((relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));

    expect("LOCAL_BASE_SEPOLIA_FIXTURE" in production).toBe(false);
    expect("DeploymentManifestShapeSchema" in production).toBe(false);
    expect("assertManifestShapeSemantics" in production).toBe(false);
    for (const productionSource of productionSources) {
      expect(productionSource).not.toContain("local-test-fixture");
      expect(productionSource).not.toContain("GENERATED_LOCAL_BASE_SEPOLIA_FIXTURE");
      expect(productionSource).not.toContain("generated/test-fixture");
    }
    expect(testFixture.LOCAL_BASE_SEPOLIA_FIXTURE.kind).toBe("local-test-fixture");
  });

  it("locks exact ABI digest, counts, initializer event, and removed legacy surface", () => {
    expect(LOCAL_BASE_SEPOLIA_FIXTURE.abiSha256).toBe(
      "0x2ff9f22c565dab812c496ff5fc1825c0734e51dd87fdd5c1dcd03b225d398147",
    );
    expect(DIAMOND_ABI.filter(({ type }) => type === "function")).toHaveLength(EXPECTED_SELECTOR_COUNT);
    expect(DIAMOND_ABI.filter(({ type }) => type === "event")).toHaveLength(EXPECTED_EVENT_COUNT);
    expect(DIAMOND_ABI.filter(({ type }) => type === "error")).toHaveLength(EXPECTED_ERROR_COUNT);
    expect(DIAMOND_ABI.some((item) => item.type === "event" && item.name === "ProtocolInitialized")).toBe(true);
    expect(DIAMOND_ABI.some((item) => item.type === "function" && item.name === "initV2")).toBe(false);
    expect(DIAMOND_ABI.some((item) => item.type === "function" && item.name === "setOrderPricing")).toBe(false);
    const assignmentFacet = LOCAL_BASE_SEPOLIA_FIXTURE.facets.find(({ name }) => name === "AssignmentFacet");
    expect(assignmentFacet?.functionSelectors).toContain("0xe038069a");
    expect(assignmentFacet?.functionSelectors).not.toContain("0xfbe5b267");
  });

  it("locks every public enum ordinal and bounded constant", () => {
    expect(OrderType).toEqual({ BUY: 0, SELL: 1 });
    expect(OrderStatus).toEqual({ CREATED: 0, ASSIGNED: 1, ACCEPTED: 2, FIAT_SENT: 3, COMPLETED: 4, CANCELLED: 5, EXPIRED: 6, DISPUTED: 7 });
    expect(MerchantStatus).toEqual({ PENDING: 0, ACTIVE: 1, INACTIVE: 2, BLACKLISTED: 3, DISPUTED: 4, EXITING: 5, EXITED: 6 });
    expect(MerchantAvailability).toEqual({ ONLINE: 0, OFFLINE: 1 });
    expect(ChannelStatus).toEqual({ PENDING: 0, APPROVED: 1, REJECTED: 2, TERMINATED: 3 });
    expect(ChannelAvailability).toEqual({ ACTIVE: 0, INACTIVE: 1 });
    expect(DisputeStatus).toEqual({ NONE: 0, OPEN: 1, RESOLVED: 2 });
    expect(DisputeResolution).toEqual({ CANCEL_TRADE: 0, SETTLE_TRADE: 1 });
    expect(CandidateStatus).toEqual({ NONE: 0, ASSIGNED: 1, REJECTED: 2, ACCEPTED: 3, EXPIRED: 4, RELEASED: 5 });
    expect(PublicationKind).toEqual({ AUTOMATED: 0, EMERGENCY: 1 });
    expect(SideMask).toEqual({ BUY: 1, SELL: 2, BOTH: 3 });
  });

  it("maps all 70 generated custom-error selectors to stable protocol errors", () => {
    expect(Object.keys(CONTRACT_ERROR_SELECTORS)).toHaveLength(EXPECTED_ERROR_COUNT);
    const revertData = encodeErrorResult({
      abi: DIAMOND_ABI,
      errorName: "InvalidPriceRound",
      args: [2n, 1n],
    });
    expect(mapProtocolError({ data: revertData })).toMatchObject({
      code: ProtocolErrorCode.INVALID_PRICE_ROUND,
      contractError: "InvalidPriceRound",
    });
  });
});
