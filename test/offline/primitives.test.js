"use strict";

/*
 * OFFLINE / NO AUTHORITY / NO TRANSACTIONS
 *
 * These tests exercise pure BigInt formula and replay scaffolding only. They do
 * not load Hardhat, connect to a network, access keys, sign, or move value.
 */

const { expect } = require("chai");
const {
  OFFLINE_NOTICE,
  UINT256_MAX,
  USDC_SCALE,
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
} = require("../../scripts/offline/primitives");

const Q = railQuantumMicroInr(10_000n);
const INR = 1_000_000n;
const USDC = 1_000_000n;
const ZERO_FLOOR = virtualFinishQ(0n);
const A_ID = `0x${"a1".repeat(32)}`;
const B_ID = `0x${"b2".repeat(32)}`;

function railArgs(amount, price, quantum = Q) {
  return {
    amount: usdcAtoms(amount),
    price: priceMicroInrPerUsdc(price),
    quantum,
  };
}

function hash32(byte) {
  return `0x${byte.repeat(64)}`;
}

function address(byte) {
  return `0x${byte.repeat(40)}`;
}

function envelope(overrides = {}) {
  return {
    version: 1n,
    chainId: 84_532n,
    diamond: address("1"),
    orderId: hash32("2"),
    round: 3n,
    routingDomain: hash32("4"),
    routingEpoch: 5n,
    stateBlockNumber: 44_795_919n,
    stateBlockHash: hash32("6"),
    validAfter: 100n,
    validUntil: 160n,
    quoteHash: hash32("7"),
    policyHash: hash32("8"),
    buildHash: hash32("9"),
    sequence: 10n,
    universeRoot: hash32("a"),
    universeCount: 2n,
    eligibilityPrestateRoot: hash32("b"),
    candidates: [
      { operatorId: hash32("c"), channelId: hash32("d"), rank: 0n },
      { operatorId: hash32("e"), channelId: hash32("f"), rank: 1n },
    ],
    leaseSchedule: [0n, 15n, 30n, 45n],
    outputRoot: hash32("0"),
    ...overrides,
  };
}

function deterministicGenerator(seed = 0x9e3779b97f4a7c15n) {
  let state = seed;
  return () => {
    state =
      (state * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) &
      ((1n << 64n) - 1n);
    return state;
  };
}

describe("OFFLINE / NO AUTHORITY / NO TRANSACTIONS primitives", function () {
  describe("direct rational rail formula", function () {
    it("matches the Council U=1000/P=90000001/q=10000 golden vector", function () {
      const args = railArgs(1_000n, 90_000_001n);

      expect(buyRail(args).value).to.equal(100_000n);
      expect(requiredRail(args).value).to.equal(100_000n);
      expect(sellRail(args).value).to.equal(90_000n);
      expect(buyRail(args).value).to.not.equal(90_000n);
    });

    it("handles exact, one-rational-unit-below, and one-above rail boundaries", function () {
      const exact = railArgs(1n, 20_000_000_000n);
      const below = railArgs(1n, 19_999_999_999n);
      const above = railArgs(1n, 20_000_000_001n);

      expect(buyRail(exact).value).to.equal(20_000n);
      expect(requiredRail(exact).value).to.equal(20_000n);
      expect(sellRail(exact).value).to.equal(20_000n);

      expect(buyRail(below).value).to.equal(20_000n);
      expect(requiredRail(below).value).to.equal(20_000n);
      expect(sellRail(below).value).to.equal(10_000n);

      expect(buyRail(above).value).to.equal(30_000n);
      expect(requiredRail(above).value).to.equal(30_000n);
      expect(sellRail(above).value).to.equal(20_000n);
    });

    it("satisfies direct BUY/SELL rail bounds over 10,000 deterministic vectors", function () {
      const next = deterministicGenerator();
      for (let index = 0; index < 10_000; index += 1) {
        const amount = USDC + (next() % (500n * USDC));
        const price = 50_000_000n + (next() % 100_000_001n);
        const product = amount * price;
        const buy = buyRail(railArgs(amount, price)).value;
        const required = requiredRail(railArgs(amount, price)).value;
        const sell = sellRail(railArgs(amount, price)).value;

        expect(required).to.equal(buy);
        expect(buy * USDC_SCALE >= product).to.equal(true);
        expect((buy - Q.value) * USDC_SCALE < product).to.equal(true);
        expect(sell * USDC_SCALE <= product).to.equal(true);
        expect((sell + Q.value) * USDC_SCALE > product).to.equal(true);
      }
    });

    it("rejects a zero-rounded SELL", function () {
      expect(() => sellRail(railArgs(1n, 1n))).to.throw(
        "SELL conversion rounded to zero"
      );
      expect(() => sellRail(railArgs(0n, 90_000_000n))).to.throw(
        "SELL amount must be greater than zero"
      );
    });

    it("rejects negative, non-BigInt, zero divisor, and uint256 overflow inputs", function () {
      expect(() => usdcAtoms(-1n)).to.throw("uint256 bounds");
      expect(() => usdcAtoms(1)).to.throw("bigint");
      expect(() => priceMicroInrPerUsdc(0n)).to.throw("greater than zero");
      expect(() => railQuantumMicroInr(0n)).to.throw("greater than zero");
      expect(() => usdcAtoms(UINT256_MAX + 1n)).to.throw("uint256 bounds");
      expect(() =>
        buyRail({
          amount: usdcAtoms(UINT256_MAX),
          price: priceMicroInrPerUsdc(UINT256_MAX),
          quantum: railQuantumMicroInr(UINT256_MAX),
        })
      ).to.throw("result exceeds uint256 bounds");
    });

    it("rejects unit substitution instead of mixing USDC and micro-INR", function () {
      expect(() =>
        buyRail({
          amount: microInr(USDC),
          price: priceMicroInrPerUsdc(90_000_000n),
          quantum: Q,
        })
      ).to.throw("must use USDC_ATOMS");
      expect(() =>
        buyRail({
          amount: usdcAtoms(USDC),
          price: microInr(90_000_000n),
          quantum: Q,
        })
      ).to.throw("must use MICRO_INR_PER_USDC");
      expect(() =>
        buyRail({
          amount: usdcAtoms(USDC),
          price: priceMicroInrPerUsdc(90_000_000n),
          quantum: microInr(10_000n),
        })
      ).to.throw("must use RAIL_QUANTUM_MICRO_INR");
    });
  });

  describe("reservation-aware sweep-cap scaffold", function () {
    it("reproduces the 10-USDC ₹95/₹90 principal/equity vector and ₹40 cap", function () {
      const buyReceipt = buyRail(railArgs(10n * USDC, 95_000_000n));
      const accountingBacking = requiredRail(railArgs(10n * USDC, 90_000_000n));
      const cap = reservationAwareSweepCap({
        fiatPrincipal: usdcAtoms(10n * USDC),
        reservedPrincipal: usdcAtoms(0n),
        reservedFiat: microInr(0n),
        grossFiat: buyReceipt,
        accountingOrStressPrice: priceMicroInrPerUsdc(90_000_000n),
        railQuantum: Q,
        safetyBuffer: microInr(10n * INR),
      });

      expect(buyReceipt.value).to.equal(950n * INR);
      expect(accountingBacking.value).to.equal(900n * INR);
      expect(buyReceipt.value - accountingBacking.value).to.equal(50n * INR);
      expect(cap.sweepable.value).to.equal(40n * INR);
      expect(90n * USDC + 10n * USDC).to.equal(100n * USDC);
    });

    it("caps the locked-payout vector at ₹40 and rejects ₹40.01/₹41", function () {
      const cap = reservationAwareSweepCap({
        fiatPrincipal: usdcAtoms(10n * USDC),
        reservedPrincipal: usdcAtoms(10n * USDC),
        reservedFiat: microInr(950n * INR),
        grossFiat: microInr(1_000n * INR),
        accountingOrStressPrice: priceMicroInrPerUsdc(90_000_000n),
        railQuantum: Q,
        safetyBuffer: microInr(10n * INR),
      });

      expect(cap.requiredFull.value).to.equal(900n * INR);
      expect(cap.reservationFloor.value).to.equal(950n * INR);
      expect(cap.retainedFloor.value).to.equal(960n * INR);
      expect(cap.sweepable.value).to.equal(40n * INR);
      expect(
        assertOfflineSweepVectorWithinCap(microInr(40n * INR), cap)
      ).to.equal(true);
      expect(() =>
        assertOfflineSweepVectorWithinCap(microInr(40n * INR + 10_000n), cap)
      ).to.throw("exceeds reservation-aware cap");
      expect(() =>
        assertOfflineSweepVectorWithinCap(microInr(41n * INR), cap)
      ).to.throw("exceeds reservation-aware cap");
    });

    it("returns zero when gross fiat is below the retained floor", function () {
      const cap = reservationAwareSweepCap({
        fiatPrincipal: usdcAtoms(10n * USDC),
        reservedPrincipal: usdcAtoms(0n),
        reservedFiat: microInr(0n),
        grossFiat: microInr(800n * INR),
        accountingOrStressPrice: priceMicroInrPerUsdc(90_000_000n),
        railQuantum: Q,
        safetyBuffer: microInr(10n * INR),
      });
      expect(cap.sweepable.value).to.equal(0n);
    });

    it("rejects impossible reservation snapshots", function () {
      const base = {
        fiatPrincipal: usdcAtoms(10n * USDC),
        reservedPrincipal: usdcAtoms(0n),
        reservedFiat: microInr(0n),
        grossFiat: microInr(1_000n * INR),
        accountingOrStressPrice: priceMicroInrPerUsdc(90_000_000n),
        railQuantum: Q,
        safetyBuffer: microInr(10n * INR),
      };
      expect(() =>
        reservationAwareSweepCap({
          ...base,
          reservedPrincipal: usdcAtoms(11n * USDC),
        })
      ).to.throw("reserved principal exceeds");
      expect(() =>
        reservationAwareSweepCap({
          ...base,
          reservedFiat: microInr(1_001n * INR),
        })
      ).to.throw("reserved fiat exceeds");
    });

    it("preserves the retained floor over 2,000 deterministic valid snapshots", function () {
      const next = deterministicGenerator(123n);
      for (let index = 0; index < 2_000; index += 1) {
        const principal = 1n + (next() % (100n * USDC));
        const reservedPrincipal = next() % (principal + 1n);
        const price = 50_000_000n + (next() % 100_000_001n);
        const required = requiredRail(railArgs(principal, price)).value;
        const gross = required + (next() % (100n * INR));
        const reservedFiat = next() % (gross + 1n);
        const buffer = next() % (10n * INR + 1n);
        const cap = reservationAwareSweepCap({
          fiatPrincipal: usdcAtoms(principal),
          reservedPrincipal: usdcAtoms(reservedPrincipal),
          reservedFiat: microInr(reservedFiat),
          grossFiat: microInr(gross),
          accountingOrStressPrice: priceMicroInrPerUsdc(price),
          railQuantum: Q,
          safetyBuffer: microInr(buffer),
        });
        const after = gross - cap.sweepable.value;
        expect(
          after >= cap.retainedFloor.value || cap.sweepable.value === 0n
        ).to.equal(true);
      }
    });

    it("rejects unit mixing in principal and fiat fields", function () {
      expect(() =>
        reservationAwareSweepCap({
          fiatPrincipal: microInr(10n * USDC),
          reservedPrincipal: usdcAtoms(0n),
          reservedFiat: microInr(0n),
          grossFiat: microInr(1_000n * INR),
          accountingOrStressPrice: priceMicroInrPerUsdc(90_000_000n),
          railQuantum: Q,
          safetyBuffer: microInr(10n * INR),
        })
      ).to.throw("must use USDC_ATOMS");
    });
  });

  describe("additive/idempotent accepted-service scaffold", function () {
    it("reproduces stale 48m→40m and the amended current-state 88m transition", function () {
      const offerA = forecastVirtualFinish({
        baseVirtualFinishQ: ZERO_FLOOR,
        domainFloorQ: ZERO_FLOOR,
        amount: usdcAtoms(10n * USDC),
      });
      const offerB = forecastVirtualFinish({
        baseVirtualFinishQ: ZERO_FLOOR,
        domainFloorQ: ZERO_FLOOR,
        amount: usdcAtoms(12n * USDC),
      });
      const amendedAfterBThenA = forecastVirtualFinish({
        baseVirtualFinishQ: offerB,
        domainFloorQ: ZERO_FLOOR,
        amount: usdcAtoms(10n * USDC),
      });

      expect(offerB.value).to.equal(48_000_000n);
      expect(offerA.value).to.equal(40_000_000n);
      expect(offerA.value < offerB.value).to.equal(true);
      expect(amendedAfterBThenA.value).to.equal(88_000_000n);
    });

    it("ends at additive service 22 and finish 88 when B is accepted before A", function () {
      let ledger = createAcceptedServiceLedger();
      ledger = applyAcceptedService(ledger, {
        acceptanceId: B_ID,
        amount: usdcAtoms(12n * USDC),
        domainFloorQ: ZERO_FLOOR,
      }).ledger;
      const finishAfterB = ledger.currentVirtualFinishQ.value;
      ledger = applyAcceptedService(ledger, {
        acceptanceId: A_ID,
        amount: usdcAtoms(10n * USDC),
        domainFloorQ: ZERO_FLOOR,
      }).ledger;

      expect(ledger.acceptedService.value).to.equal(22n * USDC);
      expect(finishAfterB).to.equal(48_000_000n);
      expect(ledger.currentVirtualFinishQ.value).to.equal(88_000_000n);
      expect(ledger.currentVirtualFinishQ.value >= finishAfterB).to.equal(true);
    });

    it("ends at additive service 22 and finish 88 when A is accepted before B", function () {
      let ledger = createAcceptedServiceLedger();
      ledger = applyAcceptedService(ledger, {
        acceptanceId: A_ID,
        amount: usdcAtoms(10n * USDC),
        domainFloorQ: ZERO_FLOOR,
      }).ledger;
      ledger = applyAcceptedService(ledger, {
        acceptanceId: B_ID,
        amount: usdcAtoms(12n * USDC),
        domainFloorQ: ZERO_FLOOR,
      }).ledger;

      expect(ledger.acceptedService.value).to.equal(22n * USDC);
      expect(ledger.currentVirtualFinishQ.value).to.equal(88_000_000n);
    });

    it("is idempotent for an identical acceptance ID and payload", function () {
      const first = applyAcceptedService(createAcceptedServiceLedger(), {
        acceptanceId: A_ID,
        amount: usdcAtoms(10n * USDC),
        domainFloorQ: ZERO_FLOOR,
      });
      const duplicate = applyAcceptedService(first.ledger, {
        acceptanceId: A_ID,
        amount: usdcAtoms(10n * USDC),
        domainFloorQ: ZERO_FLOOR,
      });

      expect(first.applied).to.equal(true);
      expect(duplicate.applied).to.equal(false);
      expect(duplicate.ledger).to.equal(first.ledger);
      expect(duplicate.ledger.acceptedService.value).to.equal(10n * USDC);
    });

    it("rejects the same acceptance ID with a changed typed payload", function () {
      const first = applyAcceptedService(createAcceptedServiceLedger(), {
        acceptanceId: A_ID,
        amount: usdcAtoms(10n * USDC),
        domainFloorQ: ZERO_FLOOR,
      });
      expect(() =>
        applyAcceptedService(first.ledger, {
          acceptanceId: A_ID,
          amount: usdcAtoms(11n * USDC),
          domainFloorQ: ZERO_FLOOR,
        })
      ).to.throw("different typed payload");
    });

    it("rebases on a higher domain floor and never regresses", function () {
      const result = applyAcceptedService(createAcceptedServiceLedger(), {
        acceptanceId: A_ID,
        amount: usdcAtoms(10n * USDC),
        domainFloorQ: virtualFinishQ(100_000_000n),
      });
      expect(result.ledger.currentVirtualFinishQ.value).to.equal(140_000_000n);
    });

    it("remains monotone over 512 deterministic unique acceptances", function () {
      const next = deterministicGenerator(456n);
      let ledger = createAcceptedServiceLedger();
      for (let index = 0; index < 512; index += 1) {
        const previousAccepted = ledger.acceptedService.value;
        const previousFinish = ledger.currentVirtualFinishQ.value;
        const amount = 1n + (next() % (20n * USDC));
        const id = `0x${BigInt(index + 1)
          .toString(16)
          .padStart(64, "0")}`;
        ledger = applyAcceptedService(ledger, {
          acceptanceId: id,
          amount: usdcAtoms(amount),
          domainFloorQ: virtualFinishQ(next() % 1_000_000_000n),
        }).ledger;
        expect(ledger.acceptedService.value).to.equal(
          previousAccepted + amount
        );
        expect(ledger.currentVirtualFinishQ.value > previousFinish).to.equal(
          true
        );
      }
    });

    it("rejects bad IDs, zero amounts, unit substitution, and overflow", function () {
      expect(() =>
        applyAcceptedService(createAcceptedServiceLedger(), {
          acceptanceId: "not-bytes32",
          amount: usdcAtoms(1n),
          domainFloorQ: ZERO_FLOOR,
        })
      ).to.throw("bytes32");
      expect(() =>
        applyAcceptedService(createAcceptedServiceLedger(), {
          acceptanceId: A_ID,
          amount: usdcAtoms(0n),
          domainFloorQ: ZERO_FLOOR,
        })
      ).to.throw("greater than zero");
      expect(() =>
        applyAcceptedService(createAcceptedServiceLedger(), {
          acceptanceId: A_ID,
          amount: microInr(1n),
          domainFloorQ: ZERO_FLOOR,
        })
      ).to.throw("must use USDC_ATOMS");
      expect(() =>
        forecastVirtualFinish({
          baseVirtualFinishQ: virtualFinishQ(UINT256_MAX),
          domainFloorQ: ZERO_FLOOR,
          amount: usdcAtoms(1n),
        })
      ).to.throw("exceeds uint256 bounds");
    });
  });

  describe("custody/liability classification scaffold", function () {
    it("classifies exact custody coverage", function () {
      const result = classifyCustodyLiabilities({
        actualCustody: usdcAtoms(100n),
        merchantTokenLiabilities: usdcAtoms(70n),
        userEscrowLiabilities: usdcAtoms(20n),
        protocolTokenLiabilities: usdcAtoms(10n),
        trackedSurplus: usdcAtoms(0n),
      });
      expect(result.status).to.equal("EXACTLY_CLASSIFIED");
      expect(result.liabilitiesCovered).to.equal(true);
      expect(result.totalLiabilities.value).to.equal(100n);
    });

    it("keeps unsolicited excess separate as unreconciled surplus", function () {
      const result = classifyCustodyLiabilities({
        actualCustody: usdcAtoms(110n),
        merchantTokenLiabilities: usdcAtoms(70n),
        userEscrowLiabilities: usdcAtoms(20n),
        protocolTokenLiabilities: usdcAtoms(10n),
        trackedSurplus: usdcAtoms(3n),
      });
      expect(result.status).to.equal("UNRECONCILED_SURPLUS");
      expect(result.observedSurplus.value).to.equal(10n);
      expect(result.trackedSurplus.value).to.equal(3n);
      expect(result.unreconciledSurplus.value).to.equal(7n);
    });

    it("reports liability deficits and tracked-surplus shortfalls distinctly", function () {
      const deficit = classifyCustodyLiabilities({
        actualCustody: usdcAtoms(99n),
        merchantTokenLiabilities: usdcAtoms(70n),
        userEscrowLiabilities: usdcAtoms(20n),
        protocolTokenLiabilities: usdcAtoms(10n),
        trackedSurplus: usdcAtoms(0n),
      });
      const shortfall = classifyCustodyLiabilities({
        actualCustody: usdcAtoms(101n),
        merchantTokenLiabilities: usdcAtoms(70n),
        userEscrowLiabilities: usdcAtoms(20n),
        protocolTokenLiabilities: usdcAtoms(10n),
        trackedSurplus: usdcAtoms(3n),
      });
      expect(deficit.status).to.equal("LIABILITY_DEFICIT");
      expect(deficit.liabilityDeficit.value).to.equal(1n);
      expect(deficit.liabilitiesCovered).to.equal(false);
      expect(shortfall.status).to.equal("TRACKED_SURPLUS_SHORTFALL");
      expect(shortfall.trackedSurplusShortfall.value).to.equal(2n);
    });

    it("rejects unit mixing and liability-sum overflow", function () {
      const base = {
        actualCustody: usdcAtoms(100n),
        merchantTokenLiabilities: usdcAtoms(70n),
        userEscrowLiabilities: usdcAtoms(20n),
        protocolTokenLiabilities: usdcAtoms(10n),
        trackedSurplus: usdcAtoms(0n),
      };
      expect(() =>
        classifyCustodyLiabilities({
          ...base,
          actualCustody: microInr(100n),
        })
      ).to.throw("must use USDC_ATOMS");
      expect(() =>
        classifyCustodyLiabilities({
          ...base,
          merchantTokenLiabilities: usdcAtoms(UINT256_MAX),
        })
      ).to.throw("exceeds uint256 bounds");
    });
  });

  describe("typed canonical decision replay envelope scaffold", function () {
    it("is explicitly non-authoritative and pins a deterministic golden hash", function () {
      expect(OFFLINE_NOTICE).to.include("NO AUTHORITY");
      expect(ENVELOPE_DOMAIN).to.include("OFFLINE");
      expect(ENVELOPE_HASH_ALGORITHM).to.include("NOT EIP-712");
      expect(hashOfflineDecisionEnvelopeNoAuthority(envelope())).to.equal(
        "0x9bffabbd1a14454eb4a65232b12ddd5ffdb10cd73870dc7531af97a1ef9d3db1"
      );
    });

    it("canonicalizes object key insertion order without dropping fields", function () {
      const original = envelope();
      const reversed = Object.fromEntries(Object.entries(original).reverse());
      expect(canonicalizeOfflineDecisionEnvelope(reversed)).to.equal(
        canonicalizeOfflineDecisionEnvelope(original)
      );
      expect(hashOfflineDecisionEnvelopeNoAuthority(reversed)).to.equal(
        hashOfflineDecisionEnvelopeNoAuthority(original)
      );
    });

    it("commits every supplied scalar, array, and tuple field", function () {
      const original = envelope();
      const originalHash = hashOfflineDecisionEnvelopeNoAuthority(original);
      const scalarMutations = {
        version: 2n,
        chainId: 1n,
        diamond: address("2"),
        orderId: hash32("3"),
        round: 4n,
        routingDomain: hash32("5"),
        routingEpoch: 6n,
        stateBlockNumber: 44_795_920n,
        stateBlockHash: hash32("7"),
        validAfter: 101n,
        validUntil: 161n,
        quoteHash: hash32("8"),
        policyHash: hash32("9"),
        buildHash: hash32("a"),
        sequence: 11n,
        universeRoot: hash32("b"),
        universeCount: 3n,
        eligibilityPrestateRoot: hash32("c"),
        outputRoot: hash32("1"),
      };
      for (const [field, value] of Object.entries(scalarMutations)) {
        expect(
          hashOfflineDecisionEnvelopeNoAuthority(envelope({ [field]: value })),
          field
        ).to.not.equal(originalHash);
      }
      expect(
        hashOfflineDecisionEnvelopeNoAuthority(
          envelope({ leaseSchedule: [0n, 15n, 31n, 45n] })
        )
      ).to.not.equal(originalHash);
      expect(
        hashOfflineDecisionEnvelopeNoAuthority(
          envelope({
            candidates: [
              { operatorId: hash32("c"), channelId: hash32("d"), rank: 1n },
              { operatorId: hash32("e"), channelId: hash32("f"), rank: 0n },
            ],
          })
        )
      ).to.not.equal(originalHash);
    });

    it("rejects missing, unknown, malformed, and non-BigInt fields", function () {
      const missing = envelope();
      delete missing.outputRoot;
      expect(() => hashOfflineDecisionEnvelopeNoAuthority(missing)).to.throw(
        "must contain exactly"
      );
      expect(() =>
        hashOfflineDecisionEnvelopeNoAuthority({
          ...envelope(),
          authorization: true,
        })
      ).to.throw("must contain exactly");
      expect(() =>
        hashOfflineDecisionEnvelopeNoAuthority(
          envelope({ stateBlockHash: "0x1234" })
        )
      ).to.throw("32-byte");
      expect(() =>
        hashOfflineDecisionEnvelopeNoAuthority(envelope({ round: 3 }))
      ).to.throw("bigint");
    });
  });
});
