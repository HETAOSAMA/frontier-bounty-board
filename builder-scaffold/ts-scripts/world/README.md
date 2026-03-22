# world 脚本

本目录用于在 **localnet** 环境下辅助开发/联调 world 合约相关能力。

## mock-killmail

用于在 `efctl env up` 的 localnet 环境中 **模拟击杀邮件**（生成 `KillmailCreatedEvent`），避免必须同时开启两个游戏客户端。

运行方式（在 `builder-scaffold/` 目录下）：

```bash
# 需要 ADMIN_PRIVATE_KEY，并且 world 已部署（deployments/localnet/world_package.json 存在）
npm run mock-killmail
```

可选环境变量：

- `KILLER_CHARACTER_ID` / `VICTIM_CHARACTER_ID`：游戏角色 item_id（u64）
- `LOSS_TYPE`：1=SHIP，2=STRUCTURE（默认 1）
- `KILLMAIL_ITEM_ID`：killmail 的 item_id（u64，默认用当前时间戳毫秒）
- `KILL_TIMESTAMP_SEC`：击杀时间（秒，默认当前时间）
- `SOLAR_SYSTEM_ID`：太阳系 item_id（默认 30000142）

输出：会打印交易 digest 与事件内容，你可以把 killmail_id 用于后续 claim 联调。
