# Frontier Bounty Board（EVE Frontier 赏金看板）

这是一个面向 **EVE Frontier** 生态的赏金 dApp（Sui）。任何人都可以发布赏金；猎人接取后，在游戏/链上产生击杀邮件（Killmail）并满足规则，即可领取赏金。

## 功能概述（MVP）

- 链：仅支持 **SUI**（`0x2::sui::SUI`）
- 发布赏金：输入 **目标钱包地址**、金额、过期（永久/自选）
- 取消赏金：仅发布者可取消；**无人接取**才可取消
- 接取赏金：允许多人接取（去重）；过期后不可接取
- 领取赏金：只有最终击杀者可领取，且必须满足：
  - 击杀者（钱包）已接取该赏金
  - 被击杀者钱包 == 赏金目标钱包
  - 击杀时间在赏金窗口内：`created_at < kill_timestamp <= expires_at`（`expires_at=0` 表示永久）
  - **仅允许击杀船（SHIP）**，建筑物（STRUCTURE）击杀不可领取

## 架构

本项目由三部分组成：

1) **Move 合约**：赏金状态机、托管资金、事件、领取验签
2) **attestor 服务**：读取链上 Killmail 事件、解析角色→钱包地址、校验、签名 claim payload
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
└─ (external) world-contracts                       # 上游依赖： https://github.com/evefrontier/world-contracts
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
