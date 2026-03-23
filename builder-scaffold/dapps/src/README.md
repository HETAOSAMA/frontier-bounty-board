# 赏金 dApp（前端）目录说明

本目录是“赏金看板”前端（React + Vite）。只做三件事：

1. **连接 Eve Vault 钱包**（Sui Wallet Standard）
2. **展示赏金列表/我的接取/我发布的**（MVP：通过 Sui GraphQL 按类型读取最近 N 条 bounty shared objects）
3. **发起链上交易**（发布/接取/取消/领取）以及调用 **attestor** 获取领取签名

## 入口文件

- `main.tsx`：挂载 React。
- `App.tsx`：页面导航（大厅/发布/我的接取/我发布的）与钱包连接入口。

## 目录结构

- `env/`：读取 Vite 环境变量（合约包 ID、ExtensionConfig ID、CoinType、attestor URL）。
- `lib/`：纯逻辑代码（不含 UI）。
  - `lib/bounty/`：赏金合约相关（交易组装、事件查询、对象解析、类型）。
  - `lib/attestor/`：调用 attestor API 获取可领取 killmail 候选。
- `pages/`：页面组件（只负责 UI + 调用 lib）。

## 关键配置（.env / VITE_ 环境变量）

- `VITE_BUILDER_PACKAGE_ID`：赏金合约发布后的 package id
- `VITE_EXTENSION_CONFIG_ID`：ExtensionConfig 对象 id（存 trusted_attestor）
- `VITE_BOUNTY_COIN_TYPE`：目前固定为 SUI（`0x2::sui::SUI`）
- `VITE_ATTESTOR_URL`：attestor 服务地址

## 目标角色选择（角色名 -> tenant+item_id）

发布赏金时，目标不再是“钱包地址”，而是 **角色 ID（tenant + item_id）**。

- 页面：`pages/CreateBountyPage.tsx`
- 角色搜索：调用 attestor `GET /characters/search?name=<substring>&limit=<n>`
- 选择结果：把候选的 `tenant/item_id` 作为 bounty.target 写入链上

## 流程图

本仓库已提供 Mermaid 流程图：`flows.mmd`（用 VSCode/Obsidian 或 GitHub 支持 Mermaid 的渲染器打开即可）。
