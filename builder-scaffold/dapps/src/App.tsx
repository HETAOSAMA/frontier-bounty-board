import { Box, Flex, Heading } from "@radix-ui/themes";
import { useConnection } from "@evefrontier/dapp-kit";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useMemo, useState } from "react";
import { getBountyDappConfigOrNull } from "./lib/bounty/config";
import { BountiesPage } from "./pages/BountiesPage";
import { CreateBountyPage } from "./pages/CreateBountyPage";
import { MyBountiesPage } from "./pages/MyBountiesPage";
import { MyHuntsPage } from "./pages/MyHuntsPage";

function App() {
  const { handleConnect, handleDisconnect } = useConnection();
  const account = useCurrentAccount();
  const cfg = useMemo(() => getBountyDappConfigOrNull(), []);
  const [tab, setTab] = useState<"bounties" | "create" | "hunts" | "mine">("bounties");

  return (
    <Box style={{ padding: "20px" }}>
      <Flex
        position="sticky"
        px="4"
        py="2"
        direction="row"
        style={{
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <Heading>赏金看板（Bounty DApp）</Heading>

        <button onClick={() => (account?.address ? handleDisconnect() : handleConnect())}>
          {account?.address ? "断开钱包" : "连接 Eve Vault"}
        </button>
      </Flex>

      {!account?.address ? (
        <Box mt="4">请先连接 Eve Vault 钱包。</Box>
      ) : !cfg ? (
        <Box mt="4" style={{ color: "crimson" }}>
          缺少配置：请设置 VITE_BUILDER_PACKAGE_ID / VITE_EXTENSION_CONFIG_ID / VITE_BOUNTY_COIN_TYPE。
        </Box>
      ) : (
        <Box mt="4">
          <Flex gap="3" mb="4" wrap="wrap">
            <button onClick={() => setTab("bounties")} disabled={tab === "bounties"}>
              赏金大厅
            </button>
            <button onClick={() => setTab("create")} disabled={tab === "create"}>
              发布赏金
            </button>
            <button onClick={() => setTab("hunts")} disabled={tab === "hunts"}>
              我的接取
            </button>
            <button onClick={() => setTab("mine")} disabled={tab === "mine"}>
              我发布的
            </button>
          </Flex>

          {tab === "bounties" ? (
            <BountiesPage builderPackageId={cfg.builderPackageId} coinType={cfg.coinType} />
          ) : null}
          {tab === "create" ? (
            <CreateBountyPage
              builderPackageId={cfg.builderPackageId}
              extensionConfigId={cfg.extensionConfigId}
              coinType={cfg.coinType}
            />
          ) : null}
          {tab === "hunts" ? (
            <MyHuntsPage
              accountAddress={account.address}
              builderPackageId={cfg.builderPackageId}
              extensionConfigId={cfg.extensionConfigId}
              coinType={cfg.coinType}
            />
          ) : null}
          {tab === "mine" ? (
            <MyBountiesPage
              accountAddress={account.address}
              builderPackageId={cfg.builderPackageId}
              coinType={cfg.coinType}
            />
          ) : null}
        </Box>
      )}
    </Box>
  );
}

export default App;
