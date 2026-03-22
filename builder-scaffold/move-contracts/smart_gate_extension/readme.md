
# Move 合约（smart_gate_extension）

本包包含一个“赏金模块”示例：`corpse_gate_bounty.move`。

## 模块职责

- `config.move`
  - 发布共享对象 `ExtensionConfig`（动态字段配置容器）
  - 发布 `AdminCap`（用于写入/更新配置）

- `corpse_gate_bounty.move`
  - 赏金对象 `Bounty<CoinType>`（共享对象，托管 SUI）
  - 发布/接取/取消/领取的状态机与事件
  - 领取时校验 attestor 签名

## 重要约定

- `target` 使用 **目标角色的钱包地址**（Sui address）。
- `created_at` / `expires_at` / `kill_timestamp` 统一使用 **毫秒时间戳**。
  - 链上 killmail 事件是秒级时间戳，需由 attestor 统一转换为毫秒后签名。
