export const ProtocolErrorCode = Object.freeze({
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INVALID_PRICE_ROUND: "INVALID_PRICE_ROUND",
  STALE_PRICE: "STALE_PRICE",
  ORDER_STATE_CONFLICT: "ORDER_STATE_CONFLICT",
  NO_ELIGIBLE_MERCHANT: "NO_ELIGIBLE_MERCHANT",
  ASSIGNMENT_REJECTED: "ASSIGNMENT_REJECTED",
  SESSION_INVALID: "SESSION_INVALID",
  CHAIN_REORG_RETRY: "CHAIN_REORG_RETRY",
  TRANSACTION_UNCERTAIN: "TRANSACTION_UNCERTAIN",
  MANIFEST_INVALID: "MANIFEST_INVALID",
  MANIFEST_DIGEST_MISMATCH: "MANIFEST_DIGEST_MISMATCH",
  MANIFEST_FIXTURE_FORBIDDEN: "MANIFEST_FIXTURE_FORBIDDEN",
  INVALID_RECEIPT: "INVALID_RECEIPT",
  ORDER_CREATED_NOT_FOUND: "ORDER_CREATED_NOT_FOUND",
  ORDER_CREATED_AMBIGUOUS: "ORDER_CREATED_AMBIGUOUS",
} as const);

export type ProtocolErrorCodeValue = (typeof ProtocolErrorCode)[keyof typeof ProtocolErrorCode];

export const ProtocolErrorMessage: Readonly<Record<ProtocolErrorCodeValue, string>> = Object.freeze({
  VALIDATION_FAILED: "The request failed protocol validation.",
  INVALID_PRICE_ROUND: "The selected price round is invalid.",
  STALE_PRICE: "The selected price is stale.",
  ORDER_STATE_CONFLICT: "The order is not in the required state.",
  NO_ELIGIBLE_MERCHANT: "No eligible merchant is currently available.",
  ASSIGNMENT_REJECTED: "The candidate assignment was rejected.",
  SESSION_INVALID: "The wallet-backed session is invalid.",
  CHAIN_REORG_RETRY: "Canonical chain state changed; retry after reconciliation.",
  TRANSACTION_UNCERTAIN: "The transaction outcome is uncertain and requires reconciliation.",
  MANIFEST_INVALID: "The protocol manifest is invalid.",
  MANIFEST_DIGEST_MISMATCH: "The protocol manifest digest does not match its content.",
  MANIFEST_FIXTURE_FORBIDDEN: "The local protocol fixture cannot be used in a shared runtime.",
  INVALID_RECEIPT: "A confirmed transaction receipt with logs is required.",
  ORDER_CREATED_NOT_FOUND: "The receipt has no OrderCreated event from the manifest Diamond.",
  ORDER_CREATED_AMBIGUOUS: "The receipt has more than one OrderCreated event from the manifest Diamond.",
});

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCodeValue;

  constructor(code: ProtocolErrorCodeValue, message: string = ProtocolErrorMessage[code]) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

export function mapProtocolError(value: unknown): Readonly<{ code: ProtocolErrorCodeValue; message: string }> {
  if (value instanceof ProtocolError) {
    return Object.freeze({ code: value.code, message: value.message });
  }
  return Object.freeze({
    code: ProtocolErrorCode.VALIDATION_FAILED,
    message: ProtocolErrorMessage.VALIDATION_FAILED,
  });
}
