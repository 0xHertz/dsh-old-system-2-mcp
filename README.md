# 外部系统连接（图形化 MCP 管理）

在 DSH Web 侧边栏新增 **外部系统连接** 面板，用图形界面管理 MCP 服务，不再手写 `cordis.yml`。

## 功能

- **连接管理**：新增、编辑、启用/停用、删除外部系统连接（MCP 服务）；列表实时显示连接状态、工具数量、认证状态。
- **三种传输**：`stdio`（本地命令）、`SSE`、`streamable HTTP`。
- **测试连接**：连接并列出 tools 才算通过；失败时区分连接、TLS、认证、列出工具等阶段，并给出可操作的原因。
- **浏览器登录捕获**：填写登录页地址后打开登录页，插件通过本地回环代理观察登录过程，自动捕获 `Authorization`、`Cookie`、`access_token`、`refresh_token`、`expires_in` 等并保存；敏感值保存后不再回显。
- **静态认证**：直接填写 `Authorization` 或其他自定义请求头。
- **自签证书**：为 HTTPS MCP 服务粘贴/上传 CA 证书 PEM，或临时选择“跳过证书校验（不安全）”。
- **自动续期**：捕获到 `refresh_token` 且配置了刷新地址时，按 `expires_in` 提前刷新；请求遇到 401 时刷新并重试一次。没有静默续期材料时，面板会明确提示重新登录。
- **凭据保护**：token / cookie / 敏感请求头存入 DSH 凭据存储（`mcp-gui/<serverId>` 记录），界面只显示 `****` 或“已保存”，日志和错误信息统一脱敏。

## 使用

1. 安装并启用本插件后，刷新页面，点击侧边栏的 **外部系统连接** 图标。
2. 点击 **新增服务**，填写服务名（即工具命名空间：`mcp__<服务名>__<工具名>`）和传输方式。
3. 选择认证方式：
   - **静态令牌 / 请求头**：在“自定义请求头”里填 `Authorization` 等，勾选“敏感”。
   - **登录页捕获**：填写登录页地址，保存并打开登录页；完成登录后回到面板，凭据会显示“已保存”。若登录响应带 `refresh_token`，可在“高级选项”里填刷新地址。
4. 登录捕获后，编辑弹窗的 **高级** 折叠区会显示认证信息摘要：请求头名称与掩码、token 类型、过期时间、是否有 refresh token、scope、client_id、捕获来源和凭据记录键。该区域默认收起，完整 token / Cookie 不会显示。
5. 点击 **测试连接**，确认能列出 tools。
6. 在会话中让智能体调用 `mcp__<服务名>__<工具名>`，无需手动贴 token。

数据位置：`$DSH_HOME/mcp-gui/servers.json`（默认为 `~/.dsh/mcp-gui/servers.json`；若进程带有 `DSH_PROFILE_DIR` 则落在该 profile 下；仅非敏感定义，权限 600）。凭据在 DSH 凭据存储的 `mcp-gui/<serverId>` 记录中。

## 登录捕获的工作方式与限制

登录捕获会为每次捕获启动一个仅监听 `127.0.0.1` 的临时 HTTP 代理，把登录页及其同源请求代理到真实服务：

- 页面运行时重写 `fetch`、XHR、表单和 `window.open` 的同源/绝对地址，使登录 API 仍经过代理，从而捕获请求头和 token 响应。
- 页面内注入脚本会扫描 `localStorage`、`sessionStorage`、`document.cookie` 和 URL 参数中的 token 并上报。
- 登录页发生跨域跳转（如 SSO）时，代理会跟随并切换基准 origin；但依赖精确 `location.origin`、跨窗口 `postMessage` 目标 origin、Service Worker、WebSocket 或复杂 SPA 路由的登录页可能无法完全捕获。
- 只应打开可信的登录页；代理只监听本机回环地址，会话 15 分钟过期。
- 如果登录页采用验证码、MFA、设备指纹等交互，仍需要你手动完成；插件只负责捕获结果。

## 安全边界

- **登录捕获代理只监听 `127.0.0.1`**，每次捕获使用随机路径和 15 分钟有效期；它没有额外的 per-session 认证，任何本机进程只要拿到完整 URL 就能访问该捕获会话。请只打开可信登录页。
- **跨域重定向会重建凭据**：origin 变化时删除上一跳的 `Authorization` / `Cookie` / `Proxy-Authorization`，再按新 origin 的 Cookie jar 重新取 Cookie；不会把 A 站凭据转发给 SSO/B 站。禁止 `https` → `http` 降级（代理只接受 http/https，但不会把凭据带去降级目标）。
- **私网 SSRF 防护**：公网登录页请求内网、链路本地（169.254/16，含云 metadata）、CGNAT（100.64/10）、组播、IPv4-mapped IPv6 或解析到这些地址的域名时返回 403；域名解析失败也会拒绝（fail closed）。若初始登录页本身就是私网地址（本地测试），则允许内网目标。
- **禁止 HTTPS → HTTP 降级**；跨域 307/308 如果还要转发登录请求体，会直接返回 403，避免把表单里的密码/token 发到另一个 origin。
- **同源重定向会重建 Cookie**：每一跳在 `Set-Cookie` 后都按目标 origin 重新生成 `Cookie` 请求头，`POST /login → 302 + Set-Cookie → /app` 能带上新会话；跨域则先删除旧 Cookie/Authorization，再取新 origin 的 Cookie。
- **Cookie 被扁平化**：上游 Cookie 的 `Domain` / `Path` / `Secure` 会被改写成当前捕获会话的本地路径；`HttpOnly` 保留给浏览器，代理侧另有 Cookie jar。依赖精确 Cookie Domain、Service Worker、WebSocket 或跨窗口 `postMessage` origin 的登录页可能无法完全捕获。
- **注入脚本**会读取并上报 `localStorage`、`sessionStorage`、`document.cookie` 和 URL 中的 token；Basic 认证头也可能被捕获。不要用它登录你不信任的站点。
- **自定义 CA 是替换 Node 的信任链**（等同于把该 PEM 当作唯一 CA），不是追加到系统信任链；`跳过证书校验` 会关闭 TLS 验证，仅用于临时自签环境。
- **刷新 token 会发往你填写的刷新地址**；只填写可信的 token 端点。捕获到的 `refresh_token` 存在凭据记录中，不会回显。
- **选择“不携带登录认证”** 后，捕获保存的 `Authorization` / `Cookie` 不会随请求发送，但仍保留在凭据记录中（方便切回登录模式）；删除服务会删除记录。切换到“静态令牌”时只发送“自定义请求头”里配置的字段，不发送旧的捕获头。如果你在自定义请求头里**显式**配置了 `Authorization`，即使认证方式为“无登录认证”也会发送——这是旧配置的兼容行为。
- **stdio 参数**会明文保存在 `servers.json` 并显示在面板中；不要把 token 放在 `args`，请用环境变量（值存入凭据记录）。
- **`/mcp-gui/api/state`** 会向已认证的 DSH Web 客户端返回服务列表、登录捕获会话 id 和自签 CA PEM（公开证书），但不返回任何 token/cookie/环境变量值。

## MCP 组（共享认证）

多个微服务可以归入一个 **MCP 组**，组持有统一认证，组内服务只登录一次：

- 组认证与单独服务一致，支持 **无认证 / 登录页捕获 / 静态请求头**；
- 组内所有服务共享同一份 `Authorization` / `Cookie` / 静态请求头；
- 任意组内服务 401，只刷新一次组认证，其他服务下一次请求自动使用新 token；
- 组外服务完全保持原有单独认证，不受影响；
- 服务编辑里的“所属组”选择组后，独立认证配置隐藏；**加入组会清除原有独立认证，移出组后需要重新独立登录/配置，不会恢复旧凭据**；
- 组内还有服务时禁止删除组，必须先把服务移出；
- 组凭据保存在 `mcp-gui/group/<groupId>` 记录，单独服务仍在 `mcp-gui/<serverId>`。

数据文件升级为 version 2，新增 `groups` 数组；旧版本没有 `groups` 时按空数组加载，现有服务自动作为单独服务，不需要手动迁移。

注意：组是“共享请求头”模型，不自动做 Cookie Domain/Path 匹配。跨域服务如果只认自己域名的 Cookie，请把它移出组单独认证，或让服务接受 Bearer。

## MCP 协议版本

插件使用 DSH 安装内置的 `@modelcontextprotocol/client` 2.2.0，协议版本由 SDK 协商，每个服务可单独选择：

| 模式 | 行为 |
|---|---|
| **自动**（新建服务默认） | 先发 `server/discover` 探测；支持则使用 **2026-07-28** 现代协议，否则回退到 2025 `initialize` 握手。 |
| **兼容 2025**（旧配置默认） | 直接走 2025 `initialize` 握手，兼容性最好。 |
| **强制 2026-07-28** | 只接受 2026-07-28；服务不支持时明确失败，不回退。 |

2025 兼容协商支持的实际修订版本由服务端选择，SDK 列表为：

- `2025-11-25`
- `2025-06-18`
- `2025-03-26`
- `2024-11-05`
- `2024-10-07`

说明：

- **SSE 传输只支持兼容 2025**；选择 SSE 时协议协商会自动切到兼容模式，自动/强制选项禁用。
- 连接成功后，服务卡片会显示实际协商到的 `MCP <version>`（HTTP/Streamable HTTP 可读取；stdio/SSE 取决于 SDK 是否暴露，可能不显示）。
- **自动模式的注意点**：SDK 在 HTTP 上把探测无响应视为上游故障，而不是“旧服务器”信号。极慢的旧服务如果自动探测超时，请切到“兼容 2025”。
- 协议版本是每个服务独立保存的，不改变 DSH 自带 `dsh-mcp-client` 或其他 MCP 服务的行为。

## 令牌请求头与 Bearer 的边界

登录接口返回的 token 不一定是 OAuth Bearer。当前实现不会在缺少依据时猜测：

- 只有响应里明确有 `token_type`，或真实请求里出现了 `Authorization: <scheme> <token>`，才会生成对应认证头；
- 普通 `token`、URL token、localStorage JWT 不会再被自动拼成 `Authorization: Bearer ...`；
- 如果服务使用自定义头（如 `X-Token`），在“认证方式 → 登录页捕获 → 高级”里填写：
  - **令牌请求头**：例如 `X-Token` 或 `Authorization`；
  - **令牌前缀**：例如 `Bearer `（注意尾随空格）或留空表示直接发送 token。
- 留空“令牌请求头”时，只保存 token 元数据，不生成 Authorization；这避免把普通 session token 误发成 Bearer。

## 工具结果长度

MCP 工具结果不会被插件截断到固定字符数。插件只对结果做敏感值脱敏，不再对脱敏后的文本做 6000 字符截断；大结果会完整返回给 DSH。若最终在模型上下文里看到压缩或省略，那是会话上下文的长度管理，不是插件截断。

DSH 自带的 `@deepseek-ai/dsh-compaction-tool-result-pruner` 另有一套上下文保护：只在压缩触发时，把超过默认 8192 字符的工具结果裁成“头部 + `[... tool result middle pruned ...]` + 尾部”，原始结果仍保留在会话日志。它不是本插件，若需要调整应改 profile 里 `tool-result-pruner` 行的 `thresholdChars`/`headChars`/`tailChars` 或停用该行。

## 自动续期的限制

- 没有 `refresh_token` 的登录会话（例如纯 Cookie 或一次性 token）无法静默续期；token 过期后会提示重新登录。这是浏览器登录捕获模式本身的限制。
- 刷新请求使用 `application/x-www-form-urlencoded` 的 `grant_type=refresh_token`。如果上游要求 JSON、额外客户端认证或轮换 client_secret，刷新会失败并显示上游错误。
- 不实现 OAuth 授权码流程、回调页、授权服务器跳转、成员间凭据共享，也不修改网关的租户与鉴权体系。

## 工具结果与流

- MCP 工具注册为 `mcp__<服务名>__<工具名>`，与 DSH 自带的 `dsh-mcp-client` 命名一致。
- 文本结果直接进入会话；图片、音频、资源链接以 `[图片 …]`、`[资源链接 …]` 等文本占位，当前版本不做图片持久化。
- 当前版本不注册 MCP resources / prompts，不读取服务端 instructions。

## 验证

源码目录内带了一套本地 mock 服务（HTTP/HTTPS MCP、登录页、refresh、cookie-only 登录、跨域重定向），无需真实远端。安装包本身不包含 `test/`：

```bash
node test/host-e2e.mjs
```

覆盖：静态令牌连接与列 tools、SSE、stdio + 环境变量、登录页捕获（token / cookie-only 手动完成）、401 刷新重试、probe 刷新、auth mode 切换、自签 CA/跳过校验/默认校验失败、禁用删除清理、跨域重定向不泄漏 Authorization、日志/状态脱敏、无工具不计通过。

## 卸载

在 **设置 > 插件** 中停用或移除本插件。停用后已注册的 MCP 工具会消失；`servers.json` 和凭据记录保留，重新启用后继续生效。删除单个服务时，其凭据记录会一并删除。
