# Attestor（领取签名服务）

`server.ts` 是赏金 dApp 的签名服务（attestor）：

- 从链上查询 `KillmailCreatedEvent`（击杀事件）
- 校验：victim_id（角色）命中 bounty.target（角色）、killer 钱包已接取、击杀时间在赏金窗口内
- 用 `PlayerProfile`（钱包拥有的对象）把 killer 钱包解析为角色 key，并与 killmail.killer_id 对比，防止他人冒领
- 对 `ClaimAttestationPayload` 进行签名，供链上 `claim_bounty` 验签

## 本地启动

在 `builder-scaffold/` 目录下：

```bash
ATTESTOR_PRIVATE_KEY=suiprivkey... \
WORLD_PACKAGE_ID=0x... \
WORLD_OBJECT_REGISTRY_ID=0x... \
TENANT=utopia \
pnpm attestor
```

推荐做法：复制 `builder-scaffold/.env.example` 为 `.env`，把上面变量写进去，然后直接执行：

```bash
pnpm run attestor
```

> `WORLD_PACKAGE_ID` 请使用 `world-contracts/contracts/world/Published.toml` 的 **original-id**（类型稳定 ID），
> 不要用 `published-at`。

前端通过 `VITE_ATTESTOR_URL` 访问该服务。

## HTTP API

- `GET /health`
  - 用于探活，返回 key_id 与 attestor 地址

- `GET /characters/search?name=<substring>&limit=<n>`
  - 通过角色名关键词搜索候选角色（返回 tenant+item_id）
  - 实现：扫描 `world::metadata::MetadataChangedEvent`，并用 `WORLD_OBJECT_REGISTRY_ID` 派生对象校验其类型为 `world::character::Character`

- `GET /candidates?bounty_id=<id>&limit=<n>`
  - 返回可领取的 killmail 候选（attestation payload + signature）

- `POST /attestations/claim`
  - 给定 claim payload（bounty_id/killmail_id/killer/victim_item_id/victim_tenant/kill_timestamp_ms），attestor 校验并签名
