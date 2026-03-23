type ViteEnvMap = Record<string, string | boolean | undefined>;

function readViteEnv(key: string): string | undefined {
  const value = (import.meta.env as ViteEnvMap)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * 读取 attestor base URL。
 * - 优先使用 VITE_ATTESTOR_URL
 * - 未配置时回退到本地默认值，避免 UI 直接崩溃（真正请求失败会在网络层返回）
 */
export function getAttestorUrl(): string {
  const configured = readViteEnv("VITE_ATTESTOR_URL")?.trim();
  return configured || "http://127.0.0.1:8787";
}

export type AttestationClaimPayload = {
  bounty_id: string;
  killmail_id: string;
  killer: string;
  victim_item_id: string;
  victim_tenant: string;
  kill_timestamp_ms: string;
};

export type AttestationClaimSuccess = {
  key_id: string;
  signature: string;
};

export type AttestationClaimResult =
  | { ok: true; value: AttestationClaimSuccess }
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

/**
 * 调用 attestor 的 /attestations/claim。
 * - 先尝试 raw payload；如果服务端只接受 {payload:{...}}，则在 4xx 时自动重试一次。
 * - 失败时返回 error 文本（优先取服务端响应体），用于 UI 直接展示。
 */
export async function requestClaimAttestation(
  payload: AttestationClaimPayload,
): Promise<AttestationClaimResult> {
  const url = `${getAttestorUrl().replace(/\/$/, "")}/attestations/claim`;

  const attempt = async (body: unknown): Promise<Response> => {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  let res: Response;
  try {
    res = await attempt(payload);
  } catch (e) {
    return { ok: false, error: String((e as Error | undefined)?.message ?? e) };
  }

  if (!res.ok && (res.status === 400 || res.status === 415 || res.status === 422)) {
    try {
      res = await attempt({ payload });
    } catch (e) {
      return { ok: false, error: String((e as Error | undefined)?.message ?? e), status: res.status };
    }
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

  if (isRecord(json)) {
    const keyId = toStringOrUndefined(json["key_id"] ?? json["keyId"]);
    const signature = toStringOrUndefined(json["signature"]);
    if (keyId && signature) {
      return { ok: true, value: { key_id: keyId, signature } };
    }
  }

  // 成功但响应不符合预期：兜底展示原文，便于定位服务端返回。
  return {
    ok: false,
    error: isRecord(json) ? `Unexpected response: ${text}` : text || "Unexpected empty response",
    status,
  };
}
