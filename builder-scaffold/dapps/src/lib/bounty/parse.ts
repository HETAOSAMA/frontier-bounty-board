import type { BountyView } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toBigIntOrUndefined(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return undefined;
}

function normalizeAddressList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().startsWith("0x"));
  }
  if (isRecord(value) && Array.isArray(value.contents)) {
    return normalizeAddressList(value.contents);
  }
  if (isRecord(value) && isRecord(value.fields) && Array.isArray(value.fields.contents)) {
    return normalizeAddressList(value.fields.contents);
  }
  return [];
}

function unwrapMoveFields(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.fields)) {
    return unwrapMoveFields(value.fields);
  }
  return value;
}

function parseBalanceValue(value: unknown): bigint | undefined {
  const unwrapped = unwrapMoveFields(value);
  if (!isRecord(unwrapped)) return undefined;
  return toBigIntOrUndefined(unwrapped.value);
}

export function parseBountyMoveObjectJson(bountyId: string, json: unknown): BountyView {
  if (!isRecord(json)) {
    return { id: bountyId, creator: "", target: "", acceptedHunters: [] };
  }

  const creator =
    toStringOrUndefined(json["creator"]) ||
    toStringOrUndefined(json["creator_address"]) ||
    "";

  const target =
    toStringOrUndefined(json["target"]) ||
    toStringOrUndefined(json["target_address"]) ||
    "";

  const lifecycle =
    toStringOrUndefined(json["lifecycle"]) ||
    toStringOrUndefined(json["status"]) ||
    toStringOrUndefined(json["state"]);

  const createdAtMs = toBigIntOrUndefined(json["created_at"] ?? json["createdAt"]);
  const expiresAtMs = toBigIntOrUndefined(json["expires_at"] ?? json["expiresAt"]);
  const acceptedHunters = normalizeAddressList(json["accepted_hunters"] ?? json["acceptedHunters"]);
  const escrowAmount = parseBalanceValue(json["escrow_balance"] ?? json["escrowBalance"]);

  return {
    id: bountyId,
    creator,
    target,
    lifecycle,
    createdAtMs,
    expiresAtMs,
    acceptedHunters,
    escrowAmount,
  };
}
