import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { buildCancelBountyTx } from "../lib/bounty/tx";
import { fetchRecentBounties } from "../lib/bounty/graphql";

export function MyBountiesPage(props: {
  accountAddress: string;
  builderPackageId: string;
  coinType: string;
}) {
  const dAppKit = useDAppKit();
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const bountiesQuery = useQuery({
    queryKey: ["mybounties.recent", props.builderPackageId, props.coinType, props.accountAddress],
    queryFn: async () => {
      const all = await fetchRecentBounties({
        builderPackageId: props.builderPackageId,
        coinType: props.coinType,
        limit: 200,
      });
      return all.filter((b) => b.creator === props.accountAddress);
    },
  });

  async function onCancel(bountyId: string) {
    setError(null);
    setDigest(null);
    setIsCancelling(true);
    try {
      const tx = buildCancelBountyTx({
        builderPackageId: props.builderPackageId,
        coinType: props.coinType,
        bountyId,
        refundTo: props.accountAddress,
      });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const d = (result as unknown as { digest?: unknown }).digest;
      setDigest(typeof d === "string" ? d : null);
      await bountiesQuery.refetch();
    } catch (e) {
      setError(String((e as Error | undefined)?.message ?? e));
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <Box>
      <Heading size="4">我发布的赏金</Heading>
      {bountiesQuery.isLoading ? <Box mt="3">加载中...</Box> : null}
      {bountiesQuery.error ? <Box mt="3" style={{ color: "crimson" }}>加载失败</Box> : null}
      {error ? <Box mt="3" style={{ color: "crimson" }}>{error}</Box> : null}
      {digest ? <Box mt="3">交易：{digest}</Box> : null}

      <Box mt="3">
        {(bountiesQuery.data ?? []).map((b) => {
          const accepted = b.acceptedHunters?.length ?? 0;
          const lifecycle = b.lifecycle ?? "";
          const canCancel = accepted === 0 && lifecycle === "Open";

          const buttonText = canCancel
            ? isCancelling
              ? "取消中..."
              : "取消"
            : lifecycle === "Cancelled"
              ? "已取消"
              : lifecycle === "Claimed"
                ? "已领取"
                : "不可取消";
          return (
            <Box key={b.id} p="3" mb="2" style={{ border: "1px solid #e2e2e2", borderRadius: 8 }}>
              <Flex justify="between" align="center" gap="3">
                <Box>
                  <Text size="2">BountyId: {b.id}</Text>
                  <div>
                    目标：{b.target ? `${b.target.tenant}:${b.target.itemId.toString()}` : "-"}
                  </div>
                  <div>状态：{lifecycle || "-"}，接取人数：{accepted}</div>
                </Box>
                <button disabled={isCancelling || !canCancel} onClick={() => onCancel(b.id)}>
                  {buttonText}
                </button>
              </Flex>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
