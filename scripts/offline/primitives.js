"use strict";

/*
 * OFFLINE / NO AUTHORITY / NO TRANSACTIONS
 *
 * Pure BigInt and deterministic hashing scaffolding admitted by the Council's
 * 2026-07-29 REJECT bill. Nothing in this file can sign, broadcast, authorize,
 * settle, sweep, reserve, migrate, initialize, deploy, or cut a Diamond.
 */

const { createHash } = require("crypto");

const OFFLINE_NOTICE =
  "OFFLINE / NO AUTHORITY / NO TRANSACTIONS / NOT A POLICY OR VALUE-MOVING IMPLEMENTATION";
const UINT256_MAX = (1n << 256n) - 1n;
const USDC_SCALE = 1_000_000n;
const VIRTUAL_WEIGHT_Q = 4n;
const QUANTITY = Symbol("p2pflow.offline.quantity");

const UNITS = Object.freeze({
  USDC_ATOMS: "USDC_ATOMS",
  MICRO_INR: "MICRO_INR",
  MICRO_INR_PER_USDC: "MICRO_INR_PER_USDC",
  RAIL_QUANTUM_MICRO_INR: "RAIL_QUANTUM_MICRO_INR",
  VIRTUAL_FINISH_Q: "VIRTUAL_FINISH_Q",
});

function assertUint256(value, label, { allowZero = true } = {}) {
  if (typeof value !== "bigint") {
    throw new TypeError(`${label} must be a bigint`);
  }
  if (value < 0n || value > UINT256_MAX) {
    throw new RangeError(`${label} must be within uint256 bounds`);
  }
  if (!allowZero && value === 0n) {
    throw new RangeError(`${label} must be greater than zero`);
  }
  return value;
}

function makeQuantity(unit, value, label = unit, options) {
  assertUint256(value, label, options);
  return Object.freeze({ [QUANTITY]: true, unit, value });
}

function usdcAtoms(value) {
  return makeQuantity(UNITS.USDC_ATOMS, value, "USDC atoms");
}

function microInr(value) {
  return makeQuantity(UNITS.MICRO_INR, value, "micro-INR");
}

function priceMicroInrPerUsdc(value) {
  return makeQuantity(
    UNITS.MICRO_INR_PER_USDC,
    value,
    "price in micro-INR per USDC",
    { allowZero: false }
  );
}

function railQuantumMicroInr(value) {
  return makeQuantity(
    UNITS.RAIL_QUANTUM_MICRO_INR,
    value,
    "rail quantum in micro-INR",
    { allowZero: false }
  );
}

function virtualFinishQ(value) {
  return makeQuantity(UNITS.VIRTUAL_FINISH_Q, value, "virtual finish Q");
}

function quantityValue(value, expectedUnit, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    value[QUANTITY] !== true ||
    value.unit !== expectedUnit
  ) {
    throw new TypeError(`${label} must use ${expectedUnit}`);
  }
  return assertUint256(value.value, label);
}

function checkedAdd(left, right, label) {
  const result = left + right;
  if (result > UINT256_MAX) {
    throw new RangeError(`${label} exceeds uint256 bounds`);
  }
  return result;
}

function checkedMultiply(left, right, label) {
  const result = left * right;
  if (result > UINT256_MAX) {
    throw new RangeError(`${label} exceeds uint256 bounds`);
  }
  return result;
}

function ceilDiv(numerator, denominator) {
  const quotient = numerator / denominator;
  return numerator % denominator === 0n ? quotient : quotient + 1n;
}

function railInputs({ amount, price, quantum }) {
  const amountValue = quantityValue(
    amount,
    UNITS.USDC_ATOMS,
    "conversion amount"
  );
  const priceValue = quantityValue(
    price,
    UNITS.MICRO_INR_PER_USDC,
    "conversion price"
  );
  const quantumValue = quantityValue(
    quantum,
    UNITS.RAIL_QUANTUM_MICRO_INR,
    "conversion rail quantum"
  );
  return { amountValue, priceValue, quantumValue };
}

function directCeilRail({ amount, price, quantum }) {
  const { amountValue, priceValue, quantumValue } = railInputs({
    amount,
    price,
    quantum,
  });
  const numerator = amountValue * priceValue;
  const denominator = USDC_SCALE * quantumValue;
  const railBuckets = ceilDiv(numerator, denominator);
  const result = railBuckets * quantumValue;
  if (result > UINT256_MAX) {
    throw new RangeError("BUY/Required rail result exceeds uint256 bounds");
  }
  return microInr(result);
}

function buyRail(input) {
  return directCeilRail(input);
}

function requiredRail(input) {
  return directCeilRail(input);
}

function sellRail({ amount, price, quantum }) {
  const { amountValue, priceValue, quantumValue } = railInputs({
    amount,
    price,
    quantum,
  });
  if (amountValue === 0n) {
    throw new RangeError("SELL amount must be greater than zero");
  }
  const numerator = amountValue * priceValue;
  const denominator = USDC_SCALE * quantumValue;
  const railBuckets = numerator / denominator;
  const result = railBuckets * quantumValue;
  if (result === 0n) {
    throw new RangeError("SELL conversion rounded to zero");
  }
  if (result > UINT256_MAX) {
    throw new RangeError("SELL rail result exceeds uint256 bounds");
  }
  return microInr(result);
}

function reservationAwareSweepCap({
  fiatPrincipal,
  reservedPrincipal,
  reservedFiat,
  grossFiat,
  accountingOrStressPrice,
  railQuantum,
  safetyBuffer,
}) {
  const principalValue = quantityValue(
    fiatPrincipal,
    UNITS.USDC_ATOMS,
    "fiat principal"
  );
  const reservedPrincipalValue = quantityValue(
    reservedPrincipal,
    UNITS.USDC_ATOMS,
    "reserved principal"
  );
  const reservedFiatValue = quantityValue(
    reservedFiat,
    UNITS.MICRO_INR,
    "reserved fiat"
  );
  const grossFiatValue = quantityValue(
    grossFiat,
    UNITS.MICRO_INR,
    "gross fiat"
  );
  const safetyBufferValue = quantityValue(
    safetyBuffer,
    UNITS.MICRO_INR,
    "safety buffer"
  );

  if (reservedPrincipalValue > principalValue) {
    throw new RangeError("reserved principal exceeds fiat principal");
  }
  if (reservedFiatValue > grossFiatValue) {
    throw new RangeError("reserved fiat exceeds gross fiat");
  }

  const requiredFull = requiredRail({
    amount: fiatPrincipal,
    price: accountingOrStressPrice,
    quantum: railQuantum,
  });
  const requiredUnreserved = requiredRail({
    amount: usdcAtoms(principalValue - reservedPrincipalValue),
    price: accountingOrStressPrice,
    quantum: railQuantum,
  });
  const reservationFloorValue = checkedAdd(
    reservedFiatValue,
    requiredUnreserved.value,
    "reservation floor"
  );
  const obligationFloorValue =
    requiredFull.value > reservationFloorValue
      ? requiredFull.value
      : reservationFloorValue;
  const retainedFloorValue = checkedAdd(
    obligationFloorValue,
    safetyBufferValue,
    "retained floor"
  );
  const sweepableValue =
    grossFiatValue > retainedFloorValue
      ? grossFiatValue - retainedFloorValue
      : 0n;

  return Object.freeze({
    notice: OFFLINE_NOTICE,
    requiredFull,
    requiredUnreserved,
    reservationFloor: microInr(reservationFloorValue),
    obligationFloor: microInr(obligationFloorValue),
    retainedFloor: microInr(retainedFloorValue),
    sweepable: microInr(sweepableValue),
  });
}

function assertOfflineSweepVectorWithinCap(requested, calculation) {
  const requestedValue = quantityValue(
    requested,
    UNITS.MICRO_INR,
    "offline sweep vector"
  );
  if (
    calculation === null ||
    typeof calculation !== "object" ||
    calculation.notice !== OFFLINE_NOTICE
  ) {
    throw new TypeError("calculation must be an offline sweep-cap result");
  }
  const capValue = quantityValue(
    calculation.sweepable,
    UNITS.MICRO_INR,
    "offline sweep cap"
  );
  if (requestedValue > capValue) {
    throw new RangeError("offline sweep vector exceeds reservation-aware cap");
  }
  return true;
}

function normalizeAcceptanceId(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError("acceptanceId must be a bytes32 hex string");
  }
  return value.toLowerCase();
}

function createAcceptedServiceLedger({
  acceptedService = usdcAtoms(0n),
  currentVirtualFinishQ = virtualFinishQ(0n),
  receipts = [],
} = {}) {
  quantityValue(acceptedService, UNITS.USDC_ATOMS, "accepted service total");
  quantityValue(
    currentVirtualFinishQ,
    UNITS.VIRTUAL_FINISH_Q,
    "current virtual finish Q"
  );
  if (!Array.isArray(receipts)) {
    throw new TypeError("acceptance receipts must be an array");
  }
  const frozenReceipts = receipts.map((receipt) => {
    const acceptanceId = normalizeAcceptanceId(receipt.acceptanceId);
    const amountValue = quantityValue(
      receipt.amount,
      UNITS.USDC_ATOMS,
      "receipt amount"
    );
    const floorValue = quantityValue(
      receipt.domainFloorQ,
      UNITS.VIRTUAL_FINISH_Q,
      "receipt domain floor Q"
    );
    return Object.freeze({
      acceptanceId,
      amount: usdcAtoms(amountValue),
      domainFloorQ: virtualFinishQ(floorValue),
    });
  });
  if (
    new Set(frozenReceipts.map((receipt) => receipt.acceptanceId)).size !==
    frozenReceipts.length
  ) {
    throw new RangeError("acceptance receipts contain duplicate IDs");
  }
  return Object.freeze({
    notice: OFFLINE_NOTICE,
    acceptedService,
    currentVirtualFinishQ,
    receipts: Object.freeze(frozenReceipts),
  });
}

function forecastVirtualFinish({ baseVirtualFinishQ, domainFloorQ, amount }) {
  const baseValue = quantityValue(
    baseVirtualFinishQ,
    UNITS.VIRTUAL_FINISH_Q,
    "forecast base virtual finish Q"
  );
  const floorValue = quantityValue(
    domainFloorQ,
    UNITS.VIRTUAL_FINISH_Q,
    "forecast domain floor Q"
  );
  const amountValue = quantityValue(
    amount,
    UNITS.USDC_ATOMS,
    "forecast accepted amount"
  );
  if (amountValue === 0n) {
    throw new RangeError("forecast accepted amount must be greater than zero");
  }
  const increment = checkedMultiply(
    amountValue,
    VIRTUAL_WEIGHT_Q,
    "virtual finish increment"
  );
  return virtualFinishQ(
    checkedAdd(
      baseValue > floorValue ? baseValue : floorValue,
      increment,
      "forecast virtual finish"
    )
  );
}

function applyAcceptedService(ledger, { acceptanceId, amount, domainFloorQ }) {
  if (
    ledger === null ||
    typeof ledger !== "object" ||
    ledger.notice !== OFFLINE_NOTICE ||
    !Array.isArray(ledger.receipts)
  ) {
    throw new TypeError("ledger must be an offline accepted-service ledger");
  }
  const normalizedId = normalizeAcceptanceId(acceptanceId);
  const amountValue = quantityValue(
    amount,
    UNITS.USDC_ATOMS,
    "accepted amount"
  );
  const floorValue = quantityValue(
    domainFloorQ,
    UNITS.VIRTUAL_FINISH_Q,
    "acceptance domain floor Q"
  );
  if (amountValue === 0n) {
    throw new RangeError("accepted amount must be greater than zero");
  }

  const existing = ledger.receipts.find(
    (receipt) => receipt.acceptanceId === normalizedId
  );
  if (existing) {
    if (
      existing.amount.value !== amountValue ||
      existing.domainFloorQ.value !== floorValue
    ) {
      throw new Error("acceptance ID replayed with different typed payload");
    }
    return Object.freeze({ ledger, applied: false });
  }

  const acceptedValue = quantityValue(
    ledger.acceptedService,
    UNITS.USDC_ATOMS,
    "ledger accepted service"
  );
  const currentFinishValue = quantityValue(
    ledger.currentVirtualFinishQ,
    UNITS.VIRTUAL_FINISH_Q,
    "ledger current virtual finish Q"
  );
  const nextAccepted = checkedAdd(
    acceptedValue,
    amountValue,
    "accepted service total"
  );
  const nextFinish = forecastVirtualFinish({
    baseVirtualFinishQ: virtualFinishQ(currentFinishValue),
    domainFloorQ,
    amount,
  });
  const receipt = Object.freeze({
    acceptanceId: normalizedId,
    amount: usdcAtoms(amountValue),
    domainFloorQ: virtualFinishQ(floorValue),
  });
  const nextLedger = createAcceptedServiceLedger({
    acceptedService: usdcAtoms(nextAccepted),
    currentVirtualFinishQ: nextFinish,
    receipts: [...ledger.receipts, receipt],
  });
  return Object.freeze({ ledger: nextLedger, applied: true });
}

function classifyCustodyLiabilities({
  actualCustody,
  merchantTokenLiabilities,
  userEscrowLiabilities,
  protocolTokenLiabilities,
  trackedSurplus,
}) {
  const actualValue = quantityValue(
    actualCustody,
    UNITS.USDC_ATOMS,
    "actual custody"
  );
  const merchantValue = quantityValue(
    merchantTokenLiabilities,
    UNITS.USDC_ATOMS,
    "merchant token liabilities"
  );
  const userValue = quantityValue(
    userEscrowLiabilities,
    UNITS.USDC_ATOMS,
    "user escrow liabilities"
  );
  const protocolValue = quantityValue(
    protocolTokenLiabilities,
    UNITS.USDC_ATOMS,
    "protocol token liabilities"
  );
  const trackedValue = quantityValue(
    trackedSurplus,
    UNITS.USDC_ATOMS,
    "tracked surplus"
  );
  const totalLiabilitiesValue = checkedAdd(
    checkedAdd(merchantValue, userValue, "token liabilities"),
    protocolValue,
    "token liabilities"
  );
  const liabilityDeficitValue =
    actualValue < totalLiabilitiesValue
      ? totalLiabilitiesValue - actualValue
      : 0n;
  const observedSurplusValue =
    actualValue > totalLiabilitiesValue
      ? actualValue - totalLiabilitiesValue
      : 0n;
  const unreconciledSurplusValue =
    observedSurplusValue > trackedValue
      ? observedSurplusValue - trackedValue
      : 0n;
  const trackedSurplusShortfallValue =
    trackedValue > observedSurplusValue
      ? trackedValue - observedSurplusValue
      : 0n;

  let status = "EXACTLY_CLASSIFIED";
  if (liabilityDeficitValue > 0n) {
    status = "LIABILITY_DEFICIT";
  } else if (trackedSurplusShortfallValue > 0n) {
    status = "TRACKED_SURPLUS_SHORTFALL";
  } else if (unreconciledSurplusValue > 0n) {
    status = "UNRECONCILED_SURPLUS";
  }

  return Object.freeze({
    notice: OFFLINE_NOTICE,
    status,
    liabilitiesCovered: liabilityDeficitValue === 0n,
    totalLiabilities: usdcAtoms(totalLiabilitiesValue),
    liabilityDeficit: usdcAtoms(liabilityDeficitValue),
    observedSurplus: usdcAtoms(observedSurplusValue),
    trackedSurplus: usdcAtoms(trackedValue),
    unreconciledSurplus: usdcAtoms(unreconciledSurplusValue),
    trackedSurplusShortfall: usdcAtoms(trackedSurplusShortfallValue),
  });
}

const ENVELOPE_DOMAIN =
  "P2PFLOW_OFFLINE_DECISION_REPLAY_SCAFFOLD_NO_AUTHORITY_V1";
const ENVELOPE_HASH_ALGORITHM =
  "SHA-256 over strict typed canonical JSON; NOT EIP-712; NOT SIGNABLE AUTHORITY";
const ENVELOPE_FIELDS = Object.freeze([
  ["version", "uint256"],
  ["chainId", "uint256"],
  ["diamond", "address"],
  ["orderId", "bytes32"],
  ["round", "uint256"],
  ["routingDomain", "bytes32"],
  ["routingEpoch", "uint256"],
  ["stateBlockNumber", "uint256"],
  ["stateBlockHash", "bytes32"],
  ["validAfter", "uint256"],
  ["validUntil", "uint256"],
  ["quoteHash", "bytes32"],
  ["policyHash", "bytes32"],
  ["buildHash", "bytes32"],
  ["sequence", "uint256"],
  ["universeRoot", "bytes32"],
  ["universeCount", "uint256"],
  ["eligibilityPrestateRoot", "bytes32"],
  ["candidates", "tuple(bytes32 operatorId,bytes32 channelId,uint256 rank)[]"],
  ["leaseSchedule", "uint256[]"],
  ["outputRoot", "bytes32"],
]);

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `${label} must contain exactly: ${expected.join(", ")}`
    );
  }
}

function normalizeHex(value, bytes, label) {
  const expression = new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`);
  if (typeof value !== "string" || !expression.test(value)) {
    throw new TypeError(`${label} must be a ${bytes}-byte hex string`);
  }
  return value.toLowerCase();
}

function canonicalUint(value, label) {
  return assertUint256(value, label).toString(10);
}

function canonicalizeOfflineDecisionEnvelope(envelope) {
  const fieldNames = ENVELOPE_FIELDS.map(([name]) => name);
  assertExactKeys(envelope, fieldNames, "offline decision envelope");
  if (
    !Array.isArray(envelope.candidates) ||
    envelope.candidates.length > 4096
  ) {
    throw new RangeError("candidates must be an array of at most 4096 entries");
  }
  if (
    !Array.isArray(envelope.leaseSchedule) ||
    envelope.leaseSchedule.length > 4096
  ) {
    throw new RangeError(
      "leaseSchedule must be an array of at most 4096 entries"
    );
  }

  const normalizedCandidates = envelope.candidates.map((candidate, index) => {
    assertExactKeys(
      candidate,
      ["operatorId", "channelId", "rank"],
      `candidate ${index}`
    );
    return [
      normalizeHex(candidate.operatorId, 32, `candidate ${index} operatorId`),
      normalizeHex(candidate.channelId, 32, `candidate ${index} channelId`),
      canonicalUint(candidate.rank, `candidate ${index} rank`),
    ];
  });
  const typedValues = {
    version: canonicalUint(envelope.version, "version"),
    chainId: canonicalUint(envelope.chainId, "chainId"),
    diamond: normalizeHex(envelope.diamond, 20, "diamond"),
    orderId: normalizeHex(envelope.orderId, 32, "orderId"),
    round: canonicalUint(envelope.round, "round"),
    routingDomain: normalizeHex(envelope.routingDomain, 32, "routingDomain"),
    routingEpoch: canonicalUint(envelope.routingEpoch, "routingEpoch"),
    stateBlockNumber: canonicalUint(
      envelope.stateBlockNumber,
      "stateBlockNumber"
    ),
    stateBlockHash: normalizeHex(envelope.stateBlockHash, 32, "stateBlockHash"),
    validAfter: canonicalUint(envelope.validAfter, "validAfter"),
    validUntil: canonicalUint(envelope.validUntil, "validUntil"),
    quoteHash: normalizeHex(envelope.quoteHash, 32, "quoteHash"),
    policyHash: normalizeHex(envelope.policyHash, 32, "policyHash"),
    buildHash: normalizeHex(envelope.buildHash, 32, "buildHash"),
    sequence: canonicalUint(envelope.sequence, "sequence"),
    universeRoot: normalizeHex(envelope.universeRoot, 32, "universeRoot"),
    universeCount: canonicalUint(envelope.universeCount, "universeCount"),
    eligibilityPrestateRoot: normalizeHex(
      envelope.eligibilityPrestateRoot,
      32,
      "eligibilityPrestateRoot"
    ),
    candidates: normalizedCandidates,
    leaseSchedule: envelope.leaseSchedule.map((value, index) =>
      canonicalUint(value, `leaseSchedule ${index}`)
    ),
    outputRoot: normalizeHex(envelope.outputRoot, 32, "outputRoot"),
  };
  const typedSequence = ENVELOPE_FIELDS.map(([name, type]) => [
    name,
    type,
    typedValues[name],
  ]);
  return JSON.stringify([
    ["domain", "string", ENVELOPE_DOMAIN],
    ["authority", "string", "NONE"],
    ["transactions", "string", "DISABLED"],
    ...typedSequence,
  ]);
}

function hashOfflineDecisionEnvelopeNoAuthority(envelope) {
  const canonical = canonicalizeOfflineDecisionEnvelope(envelope);
  return `0x${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

module.exports = Object.freeze({
  OFFLINE_NOTICE,
  UINT256_MAX,
  USDC_SCALE,
  VIRTUAL_WEIGHT_Q,
  UNITS,
  ENVELOPE_DOMAIN,
  ENVELOPE_HASH_ALGORITHM,
  usdcAtoms,
  microInr,
  priceMicroInrPerUsdc,
  railQuantumMicroInr,
  virtualFinishQ,
  buyRail,
  sellRail,
  requiredRail,
  reservationAwareSweepCap,
  assertOfflineSweepVectorWithinCap,
  createAcceptedServiceLedger,
  forecastVirtualFinish,
  applyAcceptedService,
  classifyCustodyLiabilities,
  canonicalizeOfflineDecisionEnvelope,
  hashOfflineDecisionEnvelopeNoAuthority,
});
