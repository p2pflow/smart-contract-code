import assert from "node:assert/strict";
import test from "node:test";
import {
  JAIN_SCALE,
  exactJainIndex,
  formatScaledInteger,
  volumeSpread,
} from "../src/simulator/fairness";
import {
  CAPACITY_BINDING_ELIGIBILITY_CODES,
  MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS,
  commitCanonicalSimulationDecision,
  isCapacityBindingExclusion,
  runSimulation,
} from "../src/simulator/simulator";
import { simulationTargetsPass } from "../src/cli/simulate";
import {
  explicitUnapprovedSimulationConfig,
} from "../src/simulator/unapproved-fixture";

const USDC = 1_000_000n;

test("exact Jain and max-min metrics use integer arithmetic", () => {
  const equal = exactJainIndex([10n, 10n, 10n, 10n]);
  const skewed = exactJainIndex([40n, 0n, 0n, 0n]);
  assert.equal(equal.scaled, JAIN_SCALE);
  assert.equal(formatScaledInteger(equal.scaled, JAIN_SCALE, 12), "1.000000000000");
  assert.equal(skewed.scaled, JAIN_SCALE / 4n);
  assert.deepEqual(volumeSpread([7n, 3n, 11n]), {
    minimum: 3n,
    maximum: 11n,
    difference: 8n,
  });
});

test("capacity binding classifies only explicit limit and capacity codes", () => {
  assert.deepEqual(CAPACITY_BINDING_ELIGIBILITY_CODES, [
    "TOO_MANY_OPEN_OFFERS",
    "TOO_MANY_ACTIVE_ORDERS",
    "DAILY_LIMIT_EXCEEDED",
    "MONTHLY_LIMIT_EXCEEDED",
    "INSUFFICIENT_USDC",
    "INSUFFICIENT_FIAT_PRINCIPAL",
    "INSUFFICIENT_PHYSICAL_FIAT",
  ]);
  for (const code of CAPACITY_BINDING_ELIGIBILITY_CODES) {
    assert.equal(isCapacityBindingExclusion(code), true);
  }
  assert.equal(isCapacityBindingExclusion("MERCHANT_OFFLINE"), false);
  assert.equal(isCapacityBindingExclusion("RECONCILIATION_REQUIRED"), false);
});

test("CLI success requires every declared simulation target", () => {
  const passingTargets = {
    jainTargetScaled: 999n,
    minimumAcceptedServiceDecisions: 1,
    acceptedServiceCoveragePass: true,
    globalJainPass: true,
    comparableJainPass: true,
    maxMinAllowanceUsdc: 1n,
    globalMaxMinPass: true,
    zeroRegressionPass: true,
  };
  assert.equal(simulationTargetsPass(passingTargets), true);
  for (const target of [
    "acceptedServiceCoveragePass",
    "globalJainPass",
    "comparableJainPass",
    "globalMaxMinPass",
    "zeroRegressionPass",
  ] as const) {
    assert.equal(
      simulationTargetsPass({
        ...passingTargets,
        [target]: false,
      }),
      false,
      `${target} must fail the CLI result`,
    );
  }
});

test("CLI cannot pass an all-zero accepted-service report", () => {
  assert.equal(
    simulationTargetsPass({
      jainTargetScaled: JAIN_SCALE,
      minimumAcceptedServiceDecisions: 1,
      acceptedServiceCoveragePass: false,
      globalJainPass: true,
      comparableJainPass: true,
      maxMinAllowanceUsdc: 0n,
      globalMaxMinPass: true,
      zeroRegressionPass: true,
    }),
    false,
  );
});

test("canonical reorg gate commits no staged forward state", () => {
  const initial = {
    rankExposure: 0,
    lastActivity: null as bigint | null,
    history: [] as string[],
    offers: 0,
    ledger: 0n,
    domainFloorQ: 0n,
    canonicalMetric: 0,
  };
  let state = initial;
  const discarded = commitCanonicalSimulationDecision(
    4,
    5,
    () => {
      state = {
        rankExposure: 1,
        lastActivity: 4n,
        history: ["discarded"],
        offers: 1,
        ledger: 10n,
        domainFloorQ: 10n,
        canonicalMetric: 1,
      };
    },
  );
  assert.equal(discarded, false);
  assert.equal(state, initial);

  const committed = commitCanonicalSimulationDecision(
    5,
    5,
    () => {
      state = {
        ...state,
        rankExposure: state.rankExposure + 1,
        lastActivity: 5n,
        history: [...state.history, "canonical"],
        canonicalMetric: state.canonicalMetric + 1,
      };
    },
  );
  assert.equal(committed, true);
  assert.deepEqual(state, {
    rankExposure: 1,
    lastActivity: 5n,
    history: ["canonical"],
    offers: 0,
    ledger: 0n,
    domainFloorQ: 0n,
    canonicalMetric: 1,
  });
});

test("simulator rejects runs below the production-shaped decision floor", async () => {
  await assert.rejects(
    () =>
      runSimulation(
        explicitUnapprovedSimulationConfig(
          MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS - 1,
          "too-short",
        ),
      ),
    /explicit, bounded fixture values/,
  );
});

test(
  "two 100,000-order adversarial shadow simulations are identical and measured",
  { timeout: 1_800_000 },
  async (t) => {
    const config = explicitUnapprovedSimulationConfig(
      MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS,
      "council-adversarial-100k-v1",
    );
    const report = await runSimulation(config);
    const repeatedReport = await runSimulation(config);

    assert.deepEqual(repeatedReport, report);
    t.diagnostic(`deterministic trace root: ${report.traceRoot}`);

    assert.equal(report.capability, "TRANSACTION_DISABLED_SHADOW_ONLY");
    assert.equal(report.explicitFixtureOnly, true);
    assert.equal(report.ordersRequested, 100_000);
    assert.equal(report.decisionsComputed, 100_000);
    assert.equal(
      report.acceptedDecisions +
        report.unresolvedOrders +
        report.canonicalReorgDiscards,
      100_000,
    );
    assert.ok(report.eligibilityChanges > 0);
    assert.ok(report.reentries > 0);
    assert.ok(report.offerExposureDecisions > 0);
    assert.ok(report.leaseFallbackAcceptances > 0);
    assert.ok(Number.isSafeInteger(report.capacityBindingExclusions));
    assert.ok(report.capacityBindingExclusions >= 0);
    assert.ok(report.duplicateAcceptanceNoops > 0);
    assert.ok(report.stateCheckpoints > 0);
    assert.equal(report.virtualFinishRegressions, 0);
    assert.equal(report.targets.zeroRegressionPass, true);
    assert.equal(report.targets.acceptedServiceCoveragePass, true);
    assert.equal(report.targets.globalJainPass, true);
    assert.equal(report.targets.comparableJainPass, true);
    assert.equal(report.targets.globalMaxMinPass, true);
    assert.ok(report.comparableOperatorCount >= 4);
    assert.ok(report.largestOrderUsdc >= 500n * USDC);
  },
);
