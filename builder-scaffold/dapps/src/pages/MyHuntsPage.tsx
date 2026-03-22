import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchKillCandidates } from "../lib/attestor/client";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { buildClaimBountyTx } from "../lib/bounty/tx";
import { fetchRecentBounties } from "../lib/bounty/graphql";

export function MyHuntsPage(props: {
  accountAddress: string;
  builderPackageId: string;
  extensionConfigId: string;
  coinType: string;
}) {
  const dAppKit = useDAppKit();
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const bountiesQuery = useQuery({
    queryKey: ["myhunts.recent", props.builderPackageId, props.coinType, props.accountAddress],
    queryFn: async () => {
      const all = await fetchRecentBounties({
        builderPackageId: props.builderPackageId,
        coinType: props.coinType,
        limit: 200,
      });
      return all.filter((b) => b.acceptedHunters.includes(props.accountAddress));
    },
  });

  async function onClaim(bountyId: string) {
    setError(null);
    setDigest(null);
    setIsClaiming(true);
    try {
      const candidatesRes = await fetchKillCandidates({ bountyId, limit: 20 });
      if (!candidatesRes.ok) {
        setError(candidatesRes.error);
        return;
      }

      const mine = candidatesRes.value.filter((c) => c.killer === props.accountAddress);
      const latest = mine[0];
      if (!latest) {
        setError("未找到可领取的击杀记录（可能尚未击杀、击杀不在赏金时间内、或你不是最终击杀者）");
        return;
      }

      const sigHex = latest.attestation.signature;
      const noPrefix = sigHex.startsWith("0x") ? sigHex.slice(2) : sigHex;
      const bytes: number[] = [];
      for (let i = 0; i < noPrefix.length; i += 2) {
        bytes.push(Number.parseInt(noPrefix.slice(i, i + 2), 16));
      }

      const tx = buildClaimBountyTx({
        builderPackageId: props.builderPackageId,
        extensionConfigId: props.extensionConfigId,
        coinType: props.coinType,
        bountyId,
        payoutTo: props.accountAddress,
        killmailId: BigInt(latest.killmail_id),
        killer: latest.killer,
        victim: latest.victim,
        killTimestampMs: BigInt(latest.kill_timestamp_ms),
        isShipLoss: latest.attestation.payload.is_ship_loss === "true",
        signatureBytes: bytes,
      });

      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const d = (result as unknown as { digest?: unknown }).digest;
      setDigest(typeof d === "string" ? d : null);
    } catch (e) {
      setError(String((e as Error | undefined)?.message ?? e));
    } finally {
      setIsClaiming(false);
    }
  }

  return (
    <Box>
      <Heading size="4">我的接取</Heading>
      {bountiesQuery.isLoading ? <Box mt="3">加载中...</Box> : null}
      {bountiesQuery.error ? <Box mt="3" style={{ color: "crimson" }}>加载失败</Box> : null}
      {error ? <Box mt="3" style={{ color: "crimson" }}>{error}</Box> : null}
      {digest ? <Box mt="3">交易：{digest}</Box> : null}

      <Box mt="3">
        {(bountiesQuery.data ?? []).map((b) => (
          <Box key={b.id} p="3" mb="2" style={{ border: "1px solid #e2e2e2", borderRadius: 8 }}>
            <Flex justify="between" align="center" gap="3">
              <Box>
                <Text size="2">BountyId: {b.id}</Text>
                <div>目标：{b.target}</div>
                <div>状态：{b.lifecycle ?? "-"}</div>
              </Box>
              <button disabled={isClaiming} onClick={() => onClaim(b.id)}>
                {isClaiming ? "领取中..." : "领取"}
              </button>
            </Flex>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
