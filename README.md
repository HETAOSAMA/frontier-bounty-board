# Frontier Bounty Board（EVE Frontier × Sui）

我是 EVE Online 玩家。在 EVE Online 里也有赏金系统，但本质上只是游戏内的 ISK 激励，玩法上更多是“象征性威慑”，很难形成真正强约束、可组合的经济驱动。**Frontier Bounty Board** 则把赏金升级为 **Sui 上的真实资产托管与自动结算**：赏金不再只是“挂名”，而是链上资金锁定、条件满足即放款，让猎人有更强的行动动力，也让发布者的承诺变得可信。

这是一个面向 **EVE Frontier** 生态的赏金 dApp（Sui）。任何人都可以发布赏金；猎人接取后，在游戏/链上产生击杀邮件（Killmail）并满足规则，即可领取赏金。

## 功能概述（MVP）

- 链：仅支持 **SUI**（`0x2::sui::SUI`）
- 发布赏金：输入 **目标角色**（tenant + item_id，通过角色名下拉搜索选择）、金额、过期（永久/自选）
- 取消赏金：仅发布者可取消；**无人接取**才可取消
- 接取赏金：允许多人接取（去重）；过期后不可接取
- 领取赏金：只有最终击杀者可领取，且必须满足：
  - 击杀者（钱包）已接取该赏金
  - 被击杀者角色（victim_id）命中赏金目标角色（target）
  - 击杀时间在赏金窗口内：`created_at < kill_timestamp <= expires_at`（`expires_at=0` 表示永久）
  - **仅允许击杀船（SHIP）**，建筑物（STRUCTURE）击杀不可领取

## 为什么用 Sui（相对 EVE Online 的 ISK 赏金）

- **更强动机**：赏金是链上资产，可提现/可跨生态使用，激励强度远高于纯游戏内货币。
- **可信承诺**：资金链上托管，避免“说给就不给”“私下争议”。
- **可组合性**：链上结算天然适配更多玩法（赛事、活动、部落任务、赛季挑战）。

## 核心组件

### Move 合约（smart_gate_extension / corpse_gate_bounty）

- 赏金对象是 **shared object**，包含：`creator`、`target(角色ID tenant+item_id)`、托管余额、生命周期、接取列表等
- 支持：发布、接取、取消（无人接取前）、领取（需击杀证明 + attestor 签名）
- 强约束防盗领：`tx sender == killer` + `killer ∈ accepted_hunters` + `victim_id` 命中 `target` + **SHIP-only** + 验签

### Attestor 服务（ts-scripts/attestor）

- 查询并筛选 `KillmailCreatedEvent`（按 tenant）
- 校验：`victim_id` 命中目标、时间窗、SHIP-only
- 用 `PlayerProfile` 验证“击杀者角色”确实属于接取者钱包，防冒领
- 对 claim payload 签名，链上使用 `trusted_attestor` 验签
- 提供角色搜索：`/characters/search`（按角色名下拉选择目标）

### 前端 dApp（React/Vite）

- 赏金大厅 / 我发布的 / 我的接取
- 发布赏金：输入角色名 → 下拉候选 → 选择目标 → 托管 SUI
- 领取赏金：调用 attestor 获取候选击杀与签名 → 发起链上 claim

## 架构

本项目由三部分组成：

1) **Move 合约**：赏金状态机、托管资金、事件、领取验签
2) **attestor 服务**：读取链上 Killmail 事件、校验（目标命中/时间窗/SHIP-only/接取者身份）、签名 claim payload
3) **前端 dApp**：连接 Eve Vault（Sui Wallet Standard）、展示赏金、发交易、调用 attestor

部署与联调详见：[`DEPLOYMENT.md`](./DEPLOYMENT.md)

## 目录结构

> 主要代码在 `builder-scaffold/`。

```
.
├─ builder-scaffold/
│  ├─ move-contracts/smart_gate_extension/          # Move 合约（corpse_gate_bounty + config）
│  ├─ ts-scripts/attestor/                          # attestor（签名服务）
│  ├─ ts-scripts/smart_gate_extension/              # 合约交互脚本（create/accept/cancel/claim）
│  ├─ ts-scripts/world/                             # localnet 工具（mock-killmail 生成击杀事件）
│  ├─ dapps/                                        # 前端工程（React/Vite）
│  └─ deployments/                                  # efctl env up 的部署产物（gitignore）
└─ world-contracts/                                 # 上游参考实现（submodule）：[evefrontier/world-contracts](https://github.com/evefrontier/world-contracts)
```

## 快速开始（localnet）

1) 启动 localnet：

```bash
efctl env up
```

2) 发布 extension 合约：

```bash
efctl env extension publish builder-scaffold/move-contracts/smart_gate_extension
```

3) 配置可信 attestor：

```bash
cd builder-scaffold
npm run configure-rules
```

4) 启动 attestor：

```bash
cd builder-scaffold
npm run attestor
```

5) 启动前端：

```bash
cd builder-scaffold/dapps
npm install
npm run dev
```

---

## Hackathon 展示建议

- 用 `npm run mock-killmail` 在 localnet 生成 KillmailCreatedEvent，避免必须同时开两个游戏客户端。
- 用脚本或前端快速完成一条完整链路：发布 → 接取 → 击杀 → 领取。
