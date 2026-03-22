# Attestor（领取签名服务）

`server.ts` 是赏金 dApp 的签名服务（attestor）：

- 从链上查询 `KillmailCreatedEvent`（击杀事件）
- 将 `killer_id / victim_id`（角色 TenantItemId）解析为角色对象并读取 `character_address`（钱包地址）
- 校验：victim 命中 bounty.target、killer 已接取、击杀时间在赏金窗口内
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

前端通过 `VITE_ATTESTOR_URL` 访问该服务。
