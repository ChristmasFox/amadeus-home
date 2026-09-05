# Identity and Context Identity

## Platform Identity

每条消息包含：

- `platform`：规范平台名。
- `platformUserId`：平台稳定用户 ID。
- `displayName`：展示名称，仅用于 UI。
- `internalUserId`：可选的内部用户映射。

## InternalIdentity

实现位置：`pubg-query-engine-v3/src/platform/core/identity.ts`。

```text
InternalIdentity
├─ internalUserId
├─ roles: PUBLIC | TRUSTED | ADMIN
└─ identities
   ├─ kook: []
   ├─ telegram: []
   └─ wechat: []
```

`IdentityRegistry` 只依据 `platform + platformUserId` 做映射；昵称、用户名和 display name 不参与授权。

当前默认 registry 为空，因此所有未映射消息得到 `PUBLIC`，PUBG 查询保持公开可用。真实 Telegram identity 刻意保持未配置。

## Context Scope

实现位置：`pubg-query-engine-v3/src/context/context-store.ts`。

```text
platform : chat.type : chat.id : user.platformUserId : domain
```

示例：

```text
kook:group:kook-group:user-a:pubg
telegram:group:-2001:1001:pubg
```

这意味着：

- 同一群不同发送者不会共享 PUBG ResultSet。
- KOOK 与 Telegram 默认不共享上下文，即使未来映射到同一个 `internalUserId`。
- `internalUserId` 可用于未来权限/审计，但不改变当前平台 + chat + sender 的事实作用域。

## Authorization Contract

`IdentityRegistry.hasRole()` 支持 `PUBLIC`、`TRUSTED`、`ADMIN`。当前 PUBG 查询依赖公开角色；未来 `/organize`、重启、删除等副作用操作必须在上层显式要求 `ADMIN` 和确认，不得回退到昵称判断。
