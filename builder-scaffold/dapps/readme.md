# 赏金 dApp（前端）

这是本仓库的赏金看板前端（React + Vite）。

功能：

- 连接 **Eve Vault**（Sui Wallet Standard）
- 展示赏金大厅 / 我的接取 / 我发布的
- 发布/接取/取消/领取（领取需要调用 attestor 获取签名）

> 目标（bounty.target）是 **角色 ID（tenant + item_id）**，发布时通过角色名搜索下拉框选择。

- [React](https://react.dev/) as the UI framework
- [TypeScript](https://www.typescriptlang.org/) for type checking
- [Vite](https://vitejs.dev/) for build tooling
- [Radix UI](https://www.radix-ui.com/) for pre-built UI components
- [ESLint](https://eslint.org/)
- [`@evefrontier/dapp-kit`](https://sui-docs.evefrontier.com/) for connecting to
  wallets and loading Frontier data
- [`@mysten/dapp-kit-react`](https://sdk.mystenlabs.com/dapp-kit) for extended Sui React hooks
- [pnpm](https://pnpm.io/) for package management

## 代码入口

- `src/main.tsx`：Provider 装配（钱包、通知、React Query）
- `src/App.tsx`：页面导航（大厅/发布/我的接取/我发布的）
- `src/pages/*`：具体页面
- `src/lib/*`：纯逻辑（交易组装、GraphQL 读取 bounty 对象、调用 attestor）

更详细的目录说明见：`src/README.md`。

## 配置（.env）

> 说明：前端只需要 `VITE_*` 变量。
> **不要**把任何私钥（`*_PRIVATE_KEY`）写进前端环境变量。

最小集合（通用）：

```env
VITE_BUILDER_PACKAGE_ID=0x...
VITE_EXTENSION_CONFIG_ID=0x...
VITE_BOUNTY_COIN_TYPE=0x2::sui::SUI
VITE_EVE_WORLD_PACKAGE_ID=0x...
VITE_ATTESTOR_URL=http://127.0.0.1:8787

# Sui GraphQL（推荐显式指定）
VITE_SUI_GRAPHQL_ENDPOINT=...
```

### 变量从哪里获取？写到哪里？

| 变量 | 写入文件 | 从哪里获取 |
|---|---|---|
| `VITE_BUILDER_PACKAGE_ID` | `dapps/.env` | 发布赏金合约 `smart_gate_extension` 后输出的 package id（localnet 用 `efctl env extension publish ...`，testnet 用 `sui client publish` 或 efctl publish） |
| `VITE_EXTENSION_CONFIG_ID` | `dapps/.env` | 同上（publish 输出里会列出共享 `ExtensionConfig` object id） |
| `VITE_EVE_WORLD_PACKAGE_ID` | `dapps/.env` | 世界合约 package id（填 **original-id**）：localnet 从 `efctl env up` 输出表格/`deployments/localnet/extracted-object-ids.json`；线上从官方世界配置获取（参考 `world-contracts/contracts/world/Published.toml` 的 `original-id`） |
| `VITE_ATTESTOR_URL` | `dapps/.env` | attestor 服务地址：本机联调 `http://127.0.0.1:8787`；上线后填公网域名 |
| `VITE_SUI_GRAPHQL_ENDPOINT` | `dapps/.env` | localnet：`http://127.0.0.1:9125/graphql`（efctl 提供）；testnet：`https://graphql.testnet.sui.io/graphql` |

### 推荐：从模板复制

```bash
cp .env.example .env
```

### 配置示例：localnet（efctl）

```env
VITE_EVE_WORLD_PACKAGE_ID="0x<efctl env up 输出的 World Package ID>"
VITE_SUI_GRAPHQL_ENDPOINT="http://127.0.0.1:9125/graphql"

VITE_BUILDER_PACKAGE_ID=0x<efctl env extension publish 输出>
VITE_EXTENSION_CONFIG_ID=0x<efctl env extension publish 输出>
VITE_BOUNTY_COIN_TYPE=0x2::sui::SUI
VITE_ATTESTOR_URL=http://127.0.0.1:8787
```

### 配置示例：testnet（Utopia 等世界）

```env
VITE_EVE_WORLD_PACKAGE_ID="0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75"  # testnet_utopia original-id
VITE_SUI_GRAPHQL_ENDPOINT="https://graphql.testnet.sui.io/graphql"

VITE_BUILDER_PACKAGE_ID=0x<你发布 smart_gate_extension 的 package id>
VITE_EXTENSION_CONFIG_ID=0x<你发布 smart_gate_extension 的 ExtensionConfig id>
VITE_BOUNTY_COIN_TYPE=0x2::sui::SUI
VITE_ATTESTOR_URL=https://<你的attestor域名>
```

## 启动

安装依赖：

```bash
npm install
```

开发模式启动：

```bash
npm run dev
```

> 提示：发布赏金金额现在按 **SUI 小数输入**（例如 `0.1`），前端会自动转换为链上使用的 MIST。

## 构建

To build your app for deployment, run:

```bash
npm run build
```
