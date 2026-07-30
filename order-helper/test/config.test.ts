import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE_SEPOLIA_DIAMOND_ADDRESS,
  ConfigurationError,
  loadConfig,
} from "../src/config";

function validEnvironment(): Record<string, string> {
  return {
    CHAIN_ID: "84532",
    DIAMOND_ADDRESS: BASE_SEPOLIA_DIAMOND_ADDRESS,
    PRIMARY_RPC_URL: "https://primary.example.invalid",
    FALLBACK_RPC_URL: "https://fallback.example.invalid",
    START_BLOCK: "1",
    FINALITY_CONFIRMATIONS: "2",
    HELPER_MODE: "shadow",
    ENABLE_TRANSACTION_SENDING: "false",
    COUNCIL_VERDICT: "REJECT",
    COUNCIL_BILL_SHA256:
      "4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916",
    CONTRACT_INTERFACE_VERIFIED: "false",
    BASE_SEPOLIA_DEPLOYMENT_VERIFIED: "false",
    CANARY_APPROVED: "false",
    DATABASE_SECRET_REFERENCE: "secret://test/postgres",
    REDIS_SECRET_REFERENCE: "secret://test/redis",
    POLICY_VERSION: "wfq-v1",
    POLICY_HASH: `0x${"11".repeat(32)}`,
    HELPER_BUILD_VERSION: "test-build-1",
    CANDIDATE_COUNT: "4",
    ASSIGNMENT_TTL_SECONDS: "90",
    LEASE_STEP_SECONDS: "15",
    MAX_STATE_AGE_BLOCKS: "20",
    MAX_PENDING_OFFERS_PER_MERCHANT: "8",
    OPEN_OFFER_WEIGHT_NUMERATOR: "1",
    OPEN_OFFER_WEIGHT_DENOMINATOR: "4",
    TARGET_FIAT_SHARE_BPS: "5000",
    MAX_PRICE_DEVIATION_BPS: "100",
    MIN_MERCHANT_STAKE_USDC_ATOMS: "300000000",
    MIN_ORDER_USDC_ATOMS: "1000000",
    MAX_ORDER_USDC_ATOMS: "100000000",
    ACCEPTED_ORDER_TIMEOUT_SECONDS: "900",
    DISPUTE_WINDOW_SECONDS: "600",
    BUY_SAFETY_BUFFER_BPS: "500",
    MIN_BUY_SAFETY_BUFFER_USDC_ATOMS: "1000000",
  };
}

test("configuration is shadow-first and transaction sending is blocked", () => {
  const config = loadConfig(validEnvironment());
  assert.equal(config.mode, "shadow");
  assert.equal(config.sendGate.enabled, false);
  assert.ok(config.sendGate.blockers.includes("council verdict is REJECT"));
  assert.equal(config.council.verdict, "REJECT");
  assert.equal(config.policy.candidateCount, 4);
});

test("the council REJECT posture cannot be overridden by canary booleans", () => {
  const environment = validEnvironment();
  Object.assign(environment, {
    HELPER_MODE: "live",
    ENABLE_TRANSACTION_SENDING: "true",
    COUNCIL_VERDICT: "PASS",
    CONTRACT_INTERFACE_VERIFIED: "true",
    BASE_SEPOLIA_DEPLOYMENT_VERIFIED: "true",
    CANARY_APPROVED: "true",
  });
  assert.throws(
    () => loadConfig(environment),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.missingOrInvalidNames.includes("HELPER_MODE") &&
      error.missingOrInvalidNames.includes("ENABLE_TRANSACTION_SENDING") &&
      error.missingOrInvalidNames.includes("COUNCIL_VERDICT") &&
      error.missingOrInvalidNames.includes("CONTRACT_INTERFACE_VERIFIED") &&
      error.missingOrInvalidNames.includes(
        "BASE_SEPOLIA_DEPLOYMENT_VERIFIED",
      ) &&
      error.missingOrInvalidNames.includes("CANARY_APPROVED"),
  );
});

test("risk configuration fails closed when missing", () => {
  const environment: Record<string, string | undefined> = validEnvironment();
  delete environment.MAX_PRICE_DEVIATION_BPS;
  assert.throws(
    () => loadConfig(environment),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.missingOrInvalidNames.includes("MAX_PRICE_DEVIATION_BPS"),
  );
});

test("non-testnet and placeholder policy identity are rejected", () => {
  const environment = validEnvironment();
  environment.CHAIN_ID = "8453";
  environment.POLICY_HASH = `0x${"00".repeat(32)}`;
  assert.throws(
    () => loadConfig(environment),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.missingOrInvalidNames.includes("CHAIN_ID") &&
      error.missingOrInvalidNames.includes("POLICY_HASH"),
  );
});

test("an arbitrary Base Sepolia contract cannot replace the pinned Diamond", () => {
  const environment = validEnvironment();
  environment.DIAMOND_ADDRESS =
    "0x1111111111111111111111111111111111111111";
  assert.throws(
    () => loadConfig(environment),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.missingOrInvalidNames.includes("DIAMOND_ADDRESS"),
  );
});

test("remote cleartext and same-host fallback RPCs are rejected", () => {
  const environment = validEnvironment();
  environment.PRIMARY_RPC_URL = "http://public-rpc.example.invalid";
  environment.FALLBACK_RPC_URL =
    "https://public-rpc.example.invalid/another-tenant";
  assert.throws(
    () => loadConfig(environment),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.missingOrInvalidNames.includes("PRIMARY_RPC_URL"),
  );

  const sameHost = validEnvironment();
  sameHost.FALLBACK_RPC_URL =
    "https://primary.example.invalid/another-tenant";
  assert.throws(
    () => loadConfig(sameHost),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.missingOrInvalidNames.includes("FALLBACK_RPC_URL"),
  );
});
