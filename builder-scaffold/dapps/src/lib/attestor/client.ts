import { getAttestorUrl } from "../../env/attestor";

export type KillCandidate = {
  killmail_id: string;
  killer: string;
  victim: string;
  kill_timestamp_ms: string;
  attestation: {
    key_id: string;
    payload: {
      bounty_id: string;
      killmail_id: string;
      killer: string;
      victim: string;
      kill_timestamp: string;
      is_ship_loss: string;
    };
    signature: string;
  };
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

  if (Array.isArray(json)) {
    return { ok: true, value: json as KillCandidate[] };
  }

  return { ok: false, error: "Unexpected response from attestor", status };
}
