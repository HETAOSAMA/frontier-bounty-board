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

export function buildBountyStructType(builderPackageId: string, coinType: string): string {
  return `${builderPackageId}::corpse_gate_bounty::Bounty<${coinType}>`;
}

export async function fetchRecentBounties(args: {
  builderPackageId: string;
  coinType: string;
  limit: number;
}): Promise<BountyView[]> {
  const type = buildBountyStructType(args.builderPackageId, args.coinType);
  const res = await getObjectsByType(type, { first: args.limit });
  const nodes = (res.data?.objects?.nodes ?? []) as GraphObjectNode[];

  const out: BountyView[] = [];
  for (const n of nodes) {
    const id = typeof n.address === "string" ? n.address : "";
    const json = n.asMoveObject?.contents?.json;
    if (!id || !json) continue;
    out.push(parseBountyMoveObjectJson(id, json));
  }

  out.sort((a, b) => {
    const aa = a.createdAtMs ?? 0n;
    const bb = b.createdAtMs ?? 0n;
    if (aa === bb) return a.id.localeCompare(b.id);
    return aa > bb ? -1 : 1;
  });

  return out;
}
