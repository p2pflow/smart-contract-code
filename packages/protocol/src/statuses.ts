export const OrderType = Object.freeze({
  BUY: 0,
  SELL: 1,
} as const);
export type OrderTypeValue = (typeof OrderType)[keyof typeof OrderType];

export const OrderStatus = Object.freeze({
  CREATED: 0,
  ASSIGNED: 1,
  ACCEPTED: 2,
  FIAT_SENT: 3,
  COMPLETED: 4,
  CANCELLED: 5,
  EXPIRED: 6,
  DISPUTED: 7,
} as const);
export type OrderStatusValue = (typeof OrderStatus)[keyof typeof OrderStatus];

export const MerchantStatus = Object.freeze({
  PENDING: 0,
  ACTIVE: 1,
  INACTIVE: 2,
  BLACKLISTED: 3,
  DISPUTED: 4,
  EXITING: 5,
  EXITED: 6,
} as const);
export type MerchantStatusValue = (typeof MerchantStatus)[keyof typeof MerchantStatus];

export const MerchantAvailability = Object.freeze({ ONLINE: 0, OFFLINE: 1 } as const);
export type MerchantAvailabilityValue =
  (typeof MerchantAvailability)[keyof typeof MerchantAvailability];

export const ChannelStatus = Object.freeze({
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
  TERMINATED: 3,
} as const);
export type ChannelStatusValue = (typeof ChannelStatus)[keyof typeof ChannelStatus];

export const ChannelAvailability = Object.freeze({ ACTIVE: 0, INACTIVE: 1 } as const);
export type ChannelAvailabilityValue =
  (typeof ChannelAvailability)[keyof typeof ChannelAvailability];

export const DisputeStatus = Object.freeze({ NONE: 0, OPEN: 1, RESOLVED: 2 } as const);
export type DisputeStatusValue = (typeof DisputeStatus)[keyof typeof DisputeStatus];
export const DisputeResolution = Object.freeze({ CANCEL_TRADE: 0, SETTLE_TRADE: 1 } as const);
export type DisputeResolutionValue =
  (typeof DisputeResolution)[keyof typeof DisputeResolution];

export const CandidateStatus = Object.freeze({
  NONE: 0,
  ASSIGNED: 1,
  REJECTED: 2,
  ACCEPTED: 3,
  EXPIRED: 4,
  RELEASED: 5,
} as const);
export type CandidateStatusValue = (typeof CandidateStatus)[keyof typeof CandidateStatus];

export const PublicationKind = Object.freeze({ AUTOMATED: 0, EMERGENCY: 1 } as const);
export type PublicationKindValue = (typeof PublicationKind)[keyof typeof PublicationKind];

export const SideMask = Object.freeze({ BUY: 1, SELL: 2, BOTH: 3 } as const);
export type SideMaskValue = (typeof SideMask)[keyof typeof SideMask];

export const MAX_ASSIGNMENT_CANDIDATES = 4 as const;
export const MAX_PAGE_SIZE = 100 as const;
