# 赏金脚本（开发/调试）

本目录是 `corpse_gate_bounty` 赏金模块的命令行脚本：用于开发阶段快速验证合约调用与 attestor 联调。

## 使用前提

- 已发布 `move-contracts/smart_gate_extension`（包含 `corpse_gate_bounty` 模块）
- 已配置 `.env`：
  - `VITE_BUILDER_PACKAGE_ID`
  - `VITE_EXTENSION_CONFIG_ID`
  - `VITE_BOUNTY_COIN_TYPE`（通常为 `0x2::sui::SUI`）

## 常用命令

在 `builder-scaffold/` 目录下执行：

1) 配置可信 attestor（链上 claim 验签只信任该地址）

```bash
pnpm configure-rules
```

2) 发布赏金

```bash
BOUNTY_TARGET_ITEM_ID=900000001 \
BOUNTY_TARGET_TENANT=utopia \
BOUNTY_ESCROW_AMOUNT=1000000000 \
BOUNTY_EXPIRES_AT_MS=0 \
pnpm create-bounty
```

3) 接取赏金

```bash
pnpm accept-bounty
```

4) 取消赏金（仅发布者且无人接取才可）

```bash
pnpm cancel-bounty
```

5) 领取赏金（需要 attestor 返回的签名与 killmail 信息）

```bash
pnpm claim-bounty
```
