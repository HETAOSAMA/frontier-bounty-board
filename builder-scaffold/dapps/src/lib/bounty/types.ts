export type BountyLifecycle = "Open" | "Accepted" | "Cancelled" | "Claimed";

export type BountyView = {
  id: string;
  creator: string;
  target: string;
  lifecycle?: string;
  createdAtMs?: bigint;
  expiresAtMs?: bigint;
  acceptedHunters: string[];
  escrowAmount?: bigint;
};

export type BountyCreatedEvent = {
  bountyId: string;
  creator: string;
  target: string;
  createdAtMs: bigint;
  expiresAtMs: bigint;
  escrowAmount: bigint;
};

export type BountyAcceptedEvent = {
  bountyId: string;
  hunter: string;
  acceptedAtMs: bigint;
};
