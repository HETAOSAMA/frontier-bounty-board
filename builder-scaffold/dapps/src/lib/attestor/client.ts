import { getAttestorUrl } from "../../env/attestor";

export type KillCandidate = {
  killmail_id: string;
  killer: string;
  victim: {
    item_id: string;
    tenant: string;
  };
  kill_timestamp_ms: string;
  attestation: {
    key_id: string;
    payload: {
      bounty_id: string;
      killmail_id: string;
      killer: string;
      victim_item_id: string;
      victim_tenant: string;
      kill_timestamp: string;
      is_ship_loss: string;
    };
    signature: string;
  };
};

export type CharacterCandidate = {
  name: string;
  tenant: string;
  item_id: string;
  character_object_id: string;
  character_wallet: string;
};

type CandidatesResult =
  | { ok: true; value: KillCandidate[] }
  | { ok: false; error: string; status?: number };

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return undefined;
}

export async function fetchKillCandidates(args: {
  bountyId: string;
  limit?: number;
}): Promise<CandidatesResult> {
  const base = getAttestorUrl().replace(/\/$/, "");
  const url = new URL(`${base}/candidates`);
  url.searchParams.set("bounty_id", args.bountyId);
  if (args.limit != null) {
    url.searchParams.set("limit", String(args.limit));
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "GET" });
  } catch (e) {
    return { ok: false, error: String((e as Error | undefined)?.message ?? e) };
  }

  const status = res.status;
  const text = await res.text();
  const json = safeJsonParse(text);

  if (!res.ok) {
    if (isRecord(json)) {
      const err = toStringOrUndefined(json["error"]) || toStringOrUndefined(json["message"]);
      if (err) return { ok: false, error: err, status };
    }
    return { ok: false, error: text || `HTTP ${status}`, status };
  }

  if (isRecord(json) && Array.isArray(json["candidates"])) {
    return { ok: true, value: json["candidates"] as KillCandidate[] };
  }

  return { ok: false, error: "Unexpected response from attestor", status };
}

type CharacterSearchResult =
  | { ok: true; value: CharacterCandidate[] }
  | { ok: false; error: string; status?: number };

export async function searchCharacters(args: {
  name: string;
  limit?: number;
}): Promise<CharacterSearchResult> {
  const base = getAttestorUrl().replace(/\/$/, "");
  const url = new URL(`${base}/characters/search`);
  url.searchParams.set("name", args.name);
  if (args.limit != null) {
    url.searchParams.set("limit", String(args.limit));
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "GET" });
  } catch (e) {
    return { ok: false, error: String((e as Error | undefined)?.message ?? e) };
  }

  const status = res.status;
  const text = await res.text();
  const json = safeJsonParse(text);

  if (!res.ok) {
    if (isRecord(json)) {
      const err = toStringOrUndefined(json["error"]) || toStringOrUndefined(json["message"]);
      if (err) return { ok: false, error: err, status };
    }
    return { ok: false, error: text || `HTTP ${status}`, status };
  }

  if (isRecord(json) && Array.isArray(json["candidates"])) {
    return { ok: true, value: json["candidates"] as CharacterCandidate[] };
  }

  return { ok: false, error: "Unexpected response from attestor", status };
}
