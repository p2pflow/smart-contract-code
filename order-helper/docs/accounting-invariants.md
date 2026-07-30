# Offline accounting invariant scaffolding

This package does not implement an accounting ledger, bank reconciliation,
custody, settlement, migration, or sweep executor. The functions in
`src/accounting/rail-math.ts` are pure, deterministic golden-vector scaffolding
permitted by the 2026-07-29 Council REJECT. Their outputs never authorize an
action.

## Direct rail rounding

For USDC atoms `u`, price in micro-fiat per USDC `p`, USDC atom scale `s`, and
rail quantum in micro-fiat `q`, conversion is performed as one rational:

```text
BUY required = q * ceil((u * p) / (s * q))
SELL payout  = q * floor((u * p) / (s * q))
```

There is no intermediate conversion rounding. A nonzero SELL that would floor
to zero is rejected. All values are validated as uint256-shaped inputs, with an
explicit uint512 numerator bound for offline parity reasoning. A rounded output,
denominator, backing-floor addition, or retained-fiat addition outside uint256
is rejected rather than relying on unbounded host-language arithmetic.

## Reservation-safe sweep predicate

`reservationSafeSweep` first denies computation if any governed freeze input is
true: stale price, deficit, reconciliation required, unresolved cash treatment,
or incomplete migration. The freeze object must contain exactly those five
boolean predicates; a missing, extra, or nonboolean value is invalid. Accounting
and stress prices are independently required to be positive uint256 values.
Otherwise the formula uses the larger price, then retains the larger of:

- the rail-ceiled backing for all fiat principal; or
- reserved fiat plus rail-ceiled backing for unreserved principal.

The safety buffer is additive. Sweepable fiat is `max(gross - retained, 0)`.
Reserved principal greater than total fiat principal, or reserved fiat greater
than gross fiat, is invalid.

## Authority deliberately missing

Callers must not treat these formulas or their tests as proof of a price,
stress policy, rail quantum, bank balance, reservation, safety buffer, sweep
permission, reconciliation state, or migration completion. Those values have
no default here. No adapter invokes a bank, contract, or external database.

Golden tests cover the Council undercharge vector; exact, one-micro-fiat-below,
and one-micro-fiat-above rail boundaries; aligned/unaligned dust;
non-additivity; zero-SELL rejection; the locked-payout ₹40/₹40.01/₹41 cap; the
terminal ₹95/₹90 cycle; the separate ₹90→₹92 deficit/freeze fixture; every
freeze reason and malformed freeze schema; reservation inequalities; and
uint256 overflow. A comparison above the returned sweepable cap is mathematical
denial evidence only: no executable sweep exists in this package.
