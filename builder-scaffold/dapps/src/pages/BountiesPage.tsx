import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { fetchRecentBounties } from "../lib/bounty/graphql";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useState } from "react";
import { buildAcceptBountyTx, buildCancelBountyTx } from "../lib/bounty/tx";
import { formatMistToSui } from "../lib/sui/amount";

export function BountiesPage(props: {
  builderPackageId: string;
  coinType: string;
  limit?: number;
}) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const limit = props.limit ?? 30;
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const bountiesQuery = useQuery({
    queryKey: ["bounties.recent", props.builderPackageId, props.coinType, limit],
    queryFn: () =>
      fetchRecentBounties({
        builderPackageId: props.builderPackageId,
        coinType: props.coinType,
        limit,
      }),
  });

  async function onAccept(bountyId: string) {
    if (!account?.address) return;
    const tx = buildAcceptBountyTx({
      builderPackageId: props.builderPackageId,
      coinType: props.coinType,
      bountyId,
    });
    await dAppKit.signAndExecuteTransaction({ transaction: tx });
    await bountiesQuery.refetch();
  }

  async function onCancel(bountyId: string) {
    if (!account?.address) return;
    setCancellingId(bountyId);
    try {
      const tx = buildCancelBountyTx({
        builderPackageId: props.builderPackageId,
        coinType: props.coinType,
        bountyId,
        refundTo: account.address,
      });
      await dAppKit.signAndExecuteTransaction({ transaction: tx });
      await bountiesQuery.refetch();
    } finally {
      setCancellingId((cur) => (cur === bountyId ? null : cur));
    }
  }

  return (
    <Box>
      <Heading size="4">赏金大厅（最近 {limit} 条）</Heading>
      {bountiesQuery.isLoading ? <Box mt="3">加载中...</Box> : null}
      {bountiesQuery.error ? <Box mt="3" style={{ color: "crimson" }}>加载失败</Box> : null}

      <Box mt="3">
        {(bountiesQuery.data ?? []).map((view) => {
          const acceptedCount = view.acceptedHunters?.length ?? 0;
          const lifecycle = view.lifecycle ?? "";
          const isCreator = !!account?.address && view.creator === account.address;
          const alreadyAccepted = account?.address
            ? view.acceptedHunters.includes(account.address)
            : false;
          const canAccept =
            !!account?.address &&
            lifecycle === "Open" &&
            !alreadyAccepted &&
            !isCreator;
          const canCancel = isCreator && lifecycle === "Open" && acceptedCount === 0;
          return (
            <Box
              key={view.id}
              p="3"
              mb="2"
              style={{ border: "1px solid #e2e2e2", borderRadius: 8 }}
            >
              <Flex justify="between" align="center" gap="3">
                <Box>
                  <Text size="2">BountyId: {view.id}</Text>
                  <div>目标：{view.target}</div>
                  <div>金额：{view.escrowAmount ? `${formatMistToSui(view.escrowAmount)} SUI` : "-"}</div>
                  <div>状态：{lifecycle || "-"}，接取人数：{acceptedCount}</div>
                </Box>
                <Flex gap="2" align="center">
                  <button disabled={!canAccept} onClick={() => onAccept(view.id)}>
                    {alreadyAccepted ? "已接取" : "接取"}
                  </button>
                  <button
                    disabled={!canCancel || cancellingId === view.id}
                    onClick={() => onCancel(view.id)}
                  >
                    {canCancel ? (cancellingId === view.id ? "取消中..." : "取消") : "不可取消"}
                  </button>
                </Flex>
              </Flex>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
