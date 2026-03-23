# Builder Scaffold（Frontier Bounty Board 工程区）

`builder-scaffold/` 是本仓库的**主工程目录**：合约、attestor、前端与联调脚本都在这里。你只需要从这个目录开始看，就能完整理解并跑通“发布 → 接取 → 击杀(Killmail) → 签名 → 领取”的演示闭环。

> 仓库根目录还有两份总览文档：
> - 项目介绍：[`../README.md`](../README.md)
> - 部署/联调：[`./DEPLOYMENT.md`](./DEPLOYMENT.md)（同时仓库根目录也有一份总览版）

## 文档导航（强烈建议按此顺序阅读）

1) **部署与联调（localnet）**：[`./DEPLOYMENT.md`](./DEPLOYMENT.md)
   - `efctl env up`、发布 extension、配置 attestor、启动前端
   - 常见问题排查（Sui 本机配置、端口占用等）

2) **前端 dApp**：
   - 前端说明（工程入口/配置）：[`./dapps/readme.md`](./dapps/readme.md)
   - 更细的目录与代码说明：[`./dapps/src/README.md`](./dapps/src/README.md)
   - 流程图（Mermaid）：[`./dapps/src/flows.mmd`](./dapps/src/flows.mmd)

3) **Move 合约（赏金状态机）**：
   - 入口合约：`./move-contracts/smart_gate_extension/sources/corpse_gate_bounty.move`
   - 合约说明：`./move-contracts/smart_gate_extension/readme.md`

4) **attestor（击杀验证与签名服务）**：
   - 服务实现：`./ts-scripts/attestor/server.ts`
   - 服务说明：[`./ts-scripts/attestor/README.md`](./ts-scripts/attestor/README.md)

5) **合约交互脚本（create/accept/cancel/claim）**：
   - 说明：`./ts-scripts/smart_gate_extension/readme.md`
   - 代码：`./ts-scripts/smart_gate_extension/*.ts`

6) **localnet 模拟击杀（避免开双客户端）**：
   - 说明：[`./ts-scripts/world/README.md`](./ts-scripts/world/README.md)
    - 脚本：`./ts-scripts/world/mock-killmail.ts`

## 开发时：如何用 efctl 联调（localnet）

> 完整步骤见：[`./DEPLOYMENT.md`](./DEPLOYMENT.md)

最常用命令（在仓库根目录）：

```bash
efctl env down
efctl env up

# 发布赏金 extension
efctl env extension publish builder-scaffold/move-contracts/smart_gate_extension -n localnet
```

然后在本机（不要用 efctl 容器跑 TS 脚本，避免 esbuild 平台不匹配）：

```bash
cd builder-scaffold
npm install
npm run configure-rules
npm run attestor

# 另开终端启动前端
npm --prefix dapps run dev
```

## 上线时：如何部署到 testnet

上线同样按 `./DEPLOYMENT.md` 的第 2 章执行。关键点：

- `WORLD_PACKAGE_ID / WORLD_OBJECT_REGISTRY_ID / TENANT` 来自官方世界配置（Utopia 在 testnet 时，attestor 可直接读取游戏内 killmail）

  > 注意：`WORLD_PACKAGE_ID` 请使用 `world-contracts/contracts/world/Published.toml` 的 **original-id**（类型稳定 ID），不要用 `published-at`。
- `BUILDER_PACKAGE_ID / EXTENSION_CONFIG_ID` 来自你发布 `smart_gate_extension` 的输出
- `ATTESTOR_PRIVATE_KEY` 只放服务端，不进入前端/不提交 git

## 目录结构（高层）

| 区域 | 用途 |
|------|------|
| `move-contracts/smart_gate_extension/` | **赏金合约**（`corpse_gate_bounty.move` + `config.move`） |
| `ts-scripts/attestor/` | **attestor 服务**（读取 killmail、校验并签名 claim payload） |
| `ts-scripts/smart_gate_extension/` | 合约交互脚本（create/accept/cancel/claim + 配置规则） |
| `ts-scripts/world/` | localnet 工具（`mock-killmail` 生成 KillmailCreatedEvent） |
| `dapps/` | 前端工程（React/Vite）。主要说明在 `dapps/src/README.md` |

## 赏金模块：架构与流程

本赏金模块是一个**多猎人状态机**：多个猎人可以接取同一条赏金，但只有满足规则的最终击杀者可以领取。

### 组件

- On-chain: `move-contracts/smart_gate_extension/sources/corpse_gate_bounty.move`
- Off-chain: `ts-scripts/attestor/server.ts`
- Scripts: `ts-scripts/smart_gate_extension/*`（create/accept/cancel/claim + configure-rules）
- DApp: `dapps/src/App.tsx` + `dapps/src/pages/*`

流程图请看：`dapps/src/flows.mmd`（Mermaid）。

### 配置键（摘要）

- `BUILDER_PACKAGE_ID`: published package ID that contains `corpse_gate_bounty`
- `EXTENSION_CONFIG_ID`: `ExtensionConfig (BountyConfig)` object ID for the extension
- `BOUNTY_COIN_TYPE`: coin type used for escrow (example: a testnet coin type)
- `BOUNTY_ID`：脚本模式下可选（用于指定 bounty 对象 ID）
- 前端使用 `VITE_` 前缀：`VITE_BUILDER_PACKAGE_ID`、`VITE_EXTENSION_CONFIG_ID`、`VITE_BOUNTY_COIN_TYPE`、`VITE_ATTESTOR_URL`
- `ATTESTOR_PRIVATE_KEY`：attestor 签名私钥（链上只信任其派生地址）

### Bounty quickstart notes (localnet)

- 赏金对象是 **shared object**，不归某个地址“持有”；脚本/前端通过对象 ID 或 GraphQL（按 type）发现它。
- `create_bounty` 后会发出 `BountyCreatedEvent`，包含 `bounty_id`。
- 如果你重新 publish extension 合约，旧的对象 ID 可能会变 stale（尤其是本地环境重置后）。

### 流程（多猎人）

```mermaid
sequenceDiagram
  autonumber
  participant Publisher
  participant HunterA as Hunter A
  participant HunterB as Hunter B
  participant DApp
  participant Attestor as Local Attestor service
  participant Sui as Sui RPC

  Publisher->>Sui: create_bounty() + escrow deposit
  Note over Publisher,Sui: bounty.created_at set

  alt Cancel path (no accepts yet)
    Publisher->>Sui: cancel_bounty()
    Note over Publisher,Sui: allowed only before any accept
  else After first accept
    Note over Publisher,Sui: cancel locked after first accept
  end

  HunterA->>Sui: accept_bounty()
  Note over HunterA,Sui: Hunter A appended to accepted_hunters

  HunterB->>Sui: accept_bounty()
  Note over HunterB,Sui: Hunter B appended to accepted_hunters

  DApp->>Attestor: request killmail attestation
  Attestor->>Sui: fetch bounty + killmail context
  Attestor-->>DApp: {key_id,payload,signature}

  DApp->>Sui: claim_bounty(attestation)
  Note over DApp,Sui: Only the final valid killer can claim\nRules: killer must be in accepted_hunters; victim must match target; kill_timestamp > created_at; signature verified
```

### 常用命令

```bash
cd builder-scaffold

# 配置可信 attestor
npm run configure-rules

# 启动 attestor
npm run attestor

# 发布/接取/取消/领取（脚本）
npm run create-bounty
npm run accept-bounty
npm run cancel-bounty
npm run claim-bounty

# localnet 模拟击杀（生成 KillmailCreatedEvent）
npm run mock-killmail
```

## 常用命令（在 builder-scaffold/ 目录下）

> 完整步骤以 `./DEPLOYMENT.md` 为准；这里仅列出你日常开发最常用的命令入口。

```bash
cd builder-scaffold

# 配置可信 attestor
npm run configure-rules

# 启动 attestor
npm run attestor

# 发布/接取/取消/领取（脚本）
npm run create-bounty
npm run accept-bounty
npm run cancel-bounty
npm run claim-bounty

# localnet 模拟击杀（生成 KillmailCreatedEvent）
npm run mock-killmail

# 前端
npm --prefix dapps run dev
```
