# 部署/联调文档（Frontier Bounty Board：合约 + attestor + 前端）

本项目由三部分组成：

1) **链上合约（Move extension）**：赏金对象、状态机、资金托管、事件、领取验签与规则校验
2) **attestor 服务（Node/TS）**：读取链上 Killmail 事件 → 校验 → 对领取 payload 签名
3) **前端 dApp（React/Vite）**：连接钱包（Eve Vault）、展示赏金、发起交易、调用 attestor

> 说明：
> - 本仓库以 `builder-scaffold/` 为可运行工程根。
> - 开发联调推荐使用 `efctl env up`（localnet）。

本文件回答三个问题：

1) 开发时如何用 `efctl` 在 **localnet** 联调（发布合约、模拟击杀、领取闭环）
2) 上线时如何把合约发布到 **testnet**（Utopia 等世界在 testnet 时可直接读取游戏内 killmail）
3) 所有环境变量分别写到哪里、从哪里获取

---

## 0. 目录与关键文件

- 合约：`builder-scaffold/move-contracts/smart_gate_extension/`
- attestor：`builder-scaffold/ts-scripts/attestor/server.ts`
- 前端：`builder-scaffold/dapps/`

环境变量文件：

- `builder-scaffold/.env`：给脚本/attestor 使用（publish 后会自动更新 packageId 等）
- `builder-scaffold/dapps/.env`：给前端使用（VITE_* 变量，改完需重启 dev server）

### 0.1 环境变量总览（写到哪里？）

> 重要：`WORLD_PACKAGE_ID` 请使用 **original-id（类型稳定 ID）**。
> `world-contracts/contracts/world/Published.toml` 里同时会出现 `published-at`（升级后的新 package id）和 `original-id`。
> 我们的 attestor/前端在拼 `MoveEventType`（例如 `...::killmail::KillmailCreatedEvent`）时需要的是 **original-id**。

| 变量 | 写入位置 | 谁使用 | 从哪里获取 |
|---|---|---|---|
| `SUI_NETWORK` / `SUI_RPC_URL` | `builder-scaffold/.env` | TS 脚本、attestor | localnet 用 `http://127.0.0.1:9000`；testnet 用 `https://fullnode.testnet.sui.io:443` |
| `WORLD_PACKAGE_ID` | `builder-scaffold/.env` + `dapps/.env` | attestor / 前端 | `efctl env up` 输出表格；或 `builder-scaffold/deployments/<network>/extracted-object-ids.json`；testnet(Utopia original-id)：`0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75` |
| `WORLD_OBJECT_REGISTRY_ID` | `builder-scaffold/.env` | attestor、mock-killmail | 同上（Object Registry） |
| `TENANT` | `builder-scaffold/.env` | attestor、mock-killmail | localnet 默认 `dev`；线上从官方世界配置获取 |
| `BUILDER_PACKAGE_ID` | `builder-scaffold/.env` + `dapps/.env` | 脚本、前端 | `efctl env extension publish ...` 输出；或 `sui client publish` 输出 |
| `EXTENSION_CONFIG_ID` | `builder-scaffold/.env` + `dapps/.env` | 脚本、前端 | 同上（publish 输出里会列出共享 `ExtensionConfig` object id） |
| `ATTESTOR_PRIVATE_KEY` | 服务器环境变量（或本机 `.env`） | attestor | 你自己生成/保管（不要放前端、不要提交 git） |
| `VITE_ATTESTOR_URL` | `builder-scaffold/dapps/.env` | 前端 | 你部署的 attestor URL（localnet 用 `http://127.0.0.1:8787`） |
| `VITE_SUI_GRAPHQL_ENDPOINT` | `builder-scaffold/dapps/.env` | 前端 | localnet 用 `http://127.0.0.1:9125/graphql`（efctl 提供）；testnet 用 `https://graphql.testnet.sui.io/graphql` |
| `BOUNTY_ID` | `builder-scaffold/.env`（可选） | 脚本 | 运行 `npm run create-bounty` 后的 `BountyCreatedEvent.bounty_id` |

---

## 1. 本地部署（localnet，推荐用于联调）

### 1.1 启动本地环境（world + 节点）

在仓库根目录执行：

```bash
efctl env up
```

它会启动 localnet，并在 `builder-scaffold/deployments/localnet/` 写入 world 部署产物。

**建议：每次重置环境前先 down，避免半初始化状态：**

```bash
efctl env down
```

**获取测试币：**

```bash
efctl env faucet --address <你的地址>
```

> localnet 的 world/package/object ids 会在 `efctl env up` 输出表格中打印，也会落盘到：
> `builder-scaffold/deployments/localnet/extracted-object-ids.json`

### 1.2 发布赏金 extension 合约

```bash
efctl env extension publish builder-scaffold/move-contracts/smart_gate_extension -n localnet
```

成功后会输出并写入：

- `BUILDER_PACKAGE_ID`
- `EXTENSION_CONFIG_ID`

通常会自动更新 `builder-scaffold/.env`。

> 注意：`efctl env extension publish` 会在容器内跑 `sui client publish`。
> 但是 **不要用** `efctl env run <npm script>` 去执行 TS 脚本（例如 `configure-rules`），因为容器里是 Linux，宿主机的 `node_modules`（macOS）挂载进去会导致 `esbuild` 平台不匹配。

### 1.3 配置可信 attestor（链上验签用）

> 必须做一次：把 attestor 的公钥地址写入 `ExtensionConfig`，链上 claim 验签只信任该地址。

```bash
cd builder-scaffold
npm install
npm run configure-rules
```

配置成功后，链上 `ExtensionConfig` 会记录 `trusted_attestor` 地址；claim 时只信任该地址对 payload 的签名。

### 1.4 启动 attestor

```bash
cd builder-scaffold
npm run attestor
```

默认监听：`http://127.0.0.1:8787`。

健康检查：

```bash
curl -sS http://127.0.0.1:8787/health
```

### 1.5 启动前端

```bash
cd builder-scaffold/dapps
npm install
npm run dev
```

如果页面提示缺少配置，请检查 `builder-scaffold/dapps/.env` 是否包含：

```env
VITE_BUILDER_PACKAGE_ID=0x...
VITE_EXTENSION_CONFIG_ID=0x...
VITE_BOUNTY_COIN_TYPE=0x2::sui::SUI
VITE_EVE_WORLD_PACKAGE_ID=0x...
VITE_ATTESTOR_URL=http://127.0.0.1:8787
```

> 提示：`VITE_*` 变量修改后必须重启 `npm run dev`。

### 1.6 本地闭环（推荐按这个顺序跑一遍）

1) 发布赏金（会打印 `BountyCreatedEvent.bounty_id`）：

```bash
cd builder-scaffold
npm run create-bounty
```

2) 把输出的 `bounty_id` 写入 `builder-scaffold/.env`：

```env
BOUNTY_ID=0x...
```

3) 猎人接取：

```bash
npm run accept-bounty
```

4) 生成击杀（SHIP）：

```bash
KILLER_CHARACTER_ID=811880 VICTIM_CHARACTER_ID=900000001 LOSS_TYPE=1 npm run mock-killmail
```

5) 从 attestor 发现可领取项并领取：

```bash
curl "http://127.0.0.1:8787/candidates?bounty_id=$BOUNTY_ID&limit=10"
# 把 candidates[0].attestation.payload + signature 填到 claim-bounty 脚本环境变量
```

---

## 2. 对外部署（testnet/mainnet）

### 2.1 发布合约到目标网络

```bash
efctl env extension publish builder-scaffold/move-contracts/smart_gate_extension -n testnet
```

> 如果你不想依赖 efctl 的容器发布，也可以用 Sui CLI 在本机直接 publish：
>
> ```bash
> sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
> sui client switch --env testnet
> cd builder-scaffold/move-contracts/smart_gate_extension
> sui client publish
> ```

拿到并记录：

- `BUILDER_PACKAGE_ID`
- `EXTENSION_CONFIG_ID`

> 注意：每次 publish 会得到新的 packageId；前端和 attestor 需要同步更新。

### 2.2 部署 attestor（公网服务）

attestor 是签名 oracle，建议：

- 只暴露必要路由：`/health`、`/candidates`、`/attestations/claim`
- 生产环境用防火墙/反代限制访问（至少加 rate limit）
- 私钥仅保存在服务器安全存储中（不要进 git / 不要写在前端）

以 `systemd`/`pm2`/`docker` 任意方式运行均可。需要的环境变量（最小集合）：

```env
NETWORK=testnet
TENANT=<stillness|utopia|...>

WORLD_PACKAGE_ID=0x...
WORLD_OBJECT_REGISTRY_ID=0x...

ATTESTOR_PRIVATE_KEY=suiprivkey...
ATTESTOR_HOST=0.0.0.0
ATTESTOR_PORT=8787

# 可选：不填则用默认 fullnode
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
```

启动后，用新网络的 `EXTENSION_CONFIG_ID` 再跑一次配置：

```bash
cd builder-scaffold
NETWORK=testnet npm run configure-rules
```

> `WORLD_PACKAGE_ID` / `WORLD_OBJECT_REGISTRY_ID` / `TENANT` 这三项来自“游戏世界”的公开配置（官方提供）。
> 只要它们指向 Utopia（testnet）世界，attestor 就能直接读取游戏内产生的 `KillmailCreatedEvent`。

### 2.3 部署前端（静态站）

在 `builder-scaffold/dapps/.env` 中设置：

```env
VITE_BUILDER_PACKAGE_ID=0x...
VITE_EXTENSION_CONFIG_ID=0x...
VITE_BOUNTY_COIN_TYPE=0x2::sui::SUI
VITE_EVE_WORLD_PACKAGE_ID=0x...
VITE_ATTESTOR_URL=https://<你的-attestor-域名>

# 可选：Sui GraphQL
VITE_SUI_GRAPHQL_ENDPOINT=https://graphql.testnet.sui.io/graphql
```

构建并部署 `dist/`：

```bash
cd builder-scaffold/dapps
npm run build
```

把 `builder-scaffold/dapps/dist/` 上传到任意静态托管（Vercel/Netlify/S3/Nginx）。

> 上线检查清单（必须）：
> - `VITE_ATTESTOR_URL` 指向公网 attestor
> - `VITE_SUI_GRAPHQL_ENDPOINT` 指向对应网络的 GraphQL
> - 前端 **绝不**包含 `ATTESTOR_PRIVATE_KEY` / `ADMIN_PRIVATE_KEY` / `PLAYER_*_PRIVATE_KEY`

---

## 3. 常见问题（Troubleshooting）

### 3.1 claim 报错：Incorrect number of arguments

原因：合约签名变更（例如新增 `is_ship_loss`）但链上仍在用旧 `BUILDER_PACKAGE_ID`。

处理：重新 publish extension，并同步更新：

- `builder-scaffold/.env`：`BUILDER_PACKAGE_ID / EXTENSION_CONFIG_ID`
- `builder-scaffold/dapps/.env`：`VITE_BUILDER_PACKAGE_ID / VITE_EXTENSION_CONFIG_ID`

然后重新 `npm run configure-rules`。

### 3.2 attestor 报错：Character object ... was not found

常见原因：`WORLD_OBJECT_REGISTRY_ID` 不正确，或 attestor 没重启仍在使用旧环境。

localnet 正确值可从：

`builder-scaffold/deployments/localnet/extracted-object-ids.json` 读取。

另一个常见原因是：killmail 事件里出现了不存在的角色 id（例如 `900000002`）。
这类事件应被忽略或修正为存在的角色 id（localnet 常用：`811880`、`900000001`）。

### 3.3 端口占用：EADDRINUSE 127.0.0.1:8787

说明已有 attestor 在跑。先停掉旧进程再启动。

---

## 4. 本地模拟击杀（无需开两个游戏）

localnet 下提供脚本生成 `KillmailCreatedEvent`：

```bash
cd builder-scaffold
npm run mock-killmail
```

可选：指定击杀者/被击杀者角色 game id（u64）与 loss type：

```bash
KILLER_CHARACTER_ID=811880 \
VICTIM_CHARACTER_ID=900000001 \
LOSS_TYPE=1 \
npm run mock-killmail
```

其中 `LOSS_TYPE=1` 表示 SHIP（本项目已强制：只能“击杀船”领取赏金）。
