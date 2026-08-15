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

export const MerchantAvailability = Object.freeze({ ONLINE: 0, OFFLINE: 1 } as const);

export const ChannelStatus = Object.freeze({
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
  TERMINATED: 3,
} as const);

export const ChannelAvailability = Object.freeze({ ACTIVE: 0, INACTIVE: 1 } as const);

export const DisputeStatus = Object.freeze({ NONE: 0, OPEN: 1, RESOLVED: 2 } as const);
export const DisputeResolution = Object.freeze({ CANCEL_TRADE: 0, SETTLE_TRADE: 1 } as const);
