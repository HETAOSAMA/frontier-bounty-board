import { getObjectsByType } from "@evefrontier/dapp-kit/graphql";
import { parseBountyMoveObjectJson } from "./parse";
import type { BountyView } from "./types";

type GraphObjectNode = {
  address?: string;
  asMoveObject?: {
    contents?: {
      json?: unknown;
      type?: { repr?: string };
    };
  };
};

const MAX_OBJECTS_BY_TYPE_PAGE_SIZE = 50;

export function buildBountyStructType(builderPackageId: string, coinType: string): string {
  return `${normalizeSuiAddress(builderPackageId)}::corpse_gate_bounty::Bounty<${normalizeMoveType(
    coinType
  )}>`;
}

function normalizeSuiAddress(value: string): string {
  const raw = value.trim().toLowerCase();
  const withoutPrefix = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-f]+$/.test(withoutPrefix) || withoutPrefix.length === 0 || withoutPrefix.length > 64) {
    return value;
  }
  return `0x${withoutPrefix.padStart(64, "0")}`;
}

function normalizeMoveType(type: string): string {
  const trimmed = type.trim();
  const m = trimmed.match(/^(0x[0-9a-fA-F]+)(::.+)$/);
  if (!m) return trimmed;
  return `${normalizeSuiAddress(m[1])}${m[2]}`;
}

export async function fetchRecentBounties(args: {
  builderPackageId: string;
  coinType: string;
  limit: number;
}): Promise<BountyView[]> {
  const type = buildBountyStructType(args.builderPackageId, args.coinType);
  const out: BountyView[] = [];

  let after: string | undefined;
  while (out.length < args.limit) {
    const remaining = args.limit - out.length;
    const first = Math.min(MAX_OBJECTS_BY_TYPE_PAGE_SIZE, remaining);
    const res = await getObjectsByType(type, { first, after });
    const nodes = (res.data?.objects?.nodes ?? []) as GraphObjectNode[];

    for (const n of nodes) {
      const id = typeof n.address === "string" ? n.address : "";
      const json = n.asMoveObject?.contents?.json;
      if (!id || !json) continue;
      out.push(parseBountyMoveObjectJson(id, json));
      if (out.length >= args.limit) break;
    }

    const pageInfo = res.data?.objects?.pageInfo as
      | { hasNextPage?: boolean; endCursor?: string | null }
      | null
      | undefined;
    const endCursor = pageInfo?.endCursor ?? undefined;
    if (!pageInfo?.hasNextPage || !endCursor) {
      break;
    }
    after = endCursor;
  }

  out.sort((a, b) => {
    const aa = a.createdAtMs ?? 0n;
    const bb = b.createdAtMs ?? 0n;
    if (aa === bb) return a.id.localeCompare(b.id);
    return aa > bb ? -1 : 1;
  });

  return out;
}
