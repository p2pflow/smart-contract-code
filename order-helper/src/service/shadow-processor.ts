import { isDeepStrictEqual } from "node:util";
import { DecisionOutcome } from "../domain/types";
import {
  AppendShadowTraceResult,
  ShadowTraceConflictError,
  ShadowTraceLedger,
  ShadowTraceRecord,
  validateShadowTraceRecord,
} from "../persistence/shadow-trace-ledger";
import {
  decodeWitnessReplay,
  executeWitnessReplay,
} from "../replay/witness-codec";
import {
  selectOrder,
  SelectionInput,
  ShadowSelectionResult,
} from "../selection";

export interface ShadowProcessResult {
  readonly selection: ShadowSelectionResult;
  readonly persisted: AppendShadowTraceResult;
  readonly outcome: DecisionOutcome;
}

export class ShadowOrderProcessor {
  public constructor(
    private readonly ledger: ShadowTraceLedger,
    private readonly selector: (
      input: SelectionInput,
    ) => Promise<ShadowSelectionResult> = selectOrder,
  ) {}

  public async process(
    input: SelectionInput,
    createdAtMs: number,
  ): Promise<ShadowProcessResult> {
    if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) {
      throw new RangeError("createdAtMs must be a non-negative safe integer");
    }
    const selection = await this.selector(input);
    if (
      selection.trace.actionAuthorization !== false ||
      selection.trace.forecastOnly !== true
    ) {
      throw new ShadowTraceConflictError(
        "Injected selector attempted to claim non-shadow authority",
      );
    }
    let replayed: ShadowSelectionResult;
    try {
      replayed = await executeWitnessReplay(
        decodeWitnessReplay(selection.trace.canonicalWitness),
      );
    } catch {
      throw new ShadowTraceConflictError(
        "Injected selector returned a witness that cannot be replayed",
      );
    }
    if (!isDeepStrictEqual(selection, replayed)) {
      throw new ShadowTraceConflictError(
        "Injected selector result is detached from canonical witness replay",
      );
    }
    const decisionId =
      "decisionId" in selection.outcome
        ? selection.outcome.decisionId
        : null;
    const record: ShadowTraceRecord = {
      traceId: selection.trace.traceId,
      decisionId,
      chainId: input.order.chainId,
      orderId: input.order.orderId,
      round: input.order.round,
      sequence: input.sequence,
      stateBlock: input.order.snapshotBlock,
      stateBlockHash: input.order.snapshotBlockHash,
      policyHash: input.policy.policyHash,
      helperBuildHash: input.helperBuildHash,
      universeCount: selection.trace.universeCount,
      universeRoot: selection.trace.universeRoot,
      eligibilityPrestateRoot: selection.trace.eligibilityPrestateRoot,
      outputRoot: selection.trace.outputRoot,
      witnessContentId: selection.trace.witnessContentId,
      canonicalWitness: selection.trace.canonicalWitness,
      canonicalPayload: selection.trace.canonicalPayload,
      serviceStatus: selection.trace.serviceStatus,
      noServiceReason: selection.trace.noServiceReason,
      capability: selection.trace.capability,
      actionAuthorization: false,
      forecastOnly: true,
      selectedOperatorIds: selection.trace.selectedOperatorIds,
      createdAtMs,
    };
    validateShadowTraceRecord(record);
    const persisted = await this.ledger.append(record);
    return {
      selection,
      persisted,
      outcome: selection.outcome,
    };
  }
}
