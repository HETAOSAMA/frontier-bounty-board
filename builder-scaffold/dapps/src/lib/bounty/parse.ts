import type { BountyView, CharacterIdView } from "./types";

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

function parseLifecycle(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  const atVariant = value["@variant"];
  if (typeof atVariant === "string") return atVariant;
  const variant = value["variant"];
  if (typeof variant === "string") return variant;
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

function parseCharacterId(value: unknown): CharacterIdView | undefined {
  const unwrapped = unwrapMoveFields(value);
  if (!isRecord(unwrapped)) return undefined;
  const itemId = toBigIntOrUndefined(unwrapped["item_id"]);
  const tenant = toStringOrUndefined(unwrapped["tenant"]);
  if (itemId === undefined || !tenant) return undefined;
  return { itemId, tenant };
}

function parseEscrowAmount(value: unknown): bigint | undefined {
  const unwrapped = unwrapMoveFields(value);
  const direct = toBigIntOrUndefined(unwrapped);
  if (direct !== undefined) return direct;

  if (isRecord(unwrapped)) {
    const maybeValue = (unwrapped as Record<string, unknown>)["value"];
    const parsed = toBigIntOrUndefined(maybeValue);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

export function parseBountyMoveObjectJson(bountyId: string, json: unknown): BountyView {
  if (!isRecord(json)) {
    return { id: bountyId, creator: "", acceptedHunters: [] };
  }

  const creator =
    toStringOrUndefined(json["creator"]) ||
    toStringOrUndefined(json["creator_address"]) ||
    "";

  const target = parseCharacterId(json["target"]);

  const lifecycle =
    parseLifecycle(json["lifecycle"]) ||
    parseLifecycle(json["status"]) ||
    parseLifecycle(json["state"]);

  const createdAtMs = toBigIntOrUndefined(json["created_at"] ?? json["createdAt"]);
  const expiresAtMs = toBigIntOrUndefined(json["expires_at"] ?? json["expiresAt"]);
  const acceptedHunters = normalizeAddressList(json["accepted_hunters"] ?? json["acceptedHunters"]);
  const escrowAmount = parseEscrowAmount(json["escrow_balance"] ?? json["escrowBalance"]);

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
