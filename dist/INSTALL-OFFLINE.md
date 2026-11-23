# MCP 配置插件 1.0.10 — 离线安装

## 包内容

| 文件 | 用途 |
|---|---|
| `dsh-mcp-gui-1.0.10.tgz` | **推荐**。npm 包格式，插件管理器可直接从本地 tarball 安装 |
| `dsh-mcp-gui-1.0.10.zip` | 同样的包文件，解压后以目录方式安装（适合只接受目录的界面） |
| `INSTALL-OFFLINE.md` | 本说明 |
| `SHA256SUMS` | 校验和 |

## 前置条件

- DSH 版本与打包机一致或兼容：**0.2.2-rc.5**。插件在运行时从 DSH 安装目录解析 `@modelcontextprotocol/client`，自身**没有任何 npm 依赖**，所以不需要联网下载依赖。
- 目标是 **Web profile**（面板使用 Web 侧边栏 / 主面板 / webServer 路由；Desktop 的 Web 页面同样适用，但当前按 Web profile 打包）。
- 目标机器有 `pnpm`（DSH 插件管理器的安装前提），且能在 PATH 找到。
- 不要把 `dist/` 目录本身当成插件目录；安装的是 tarball 或解压后的包目录。

## 方式 A：Web 界面安装（推荐）

1. 把 `dsh-mcp-gui-1.0.10.tgz` 拷到目标机器。
2. 打开 DSH Web → 左下角 **设置** → **插件**。
3. 选择 **添加插件 / Add plugin**，填入 tarball 的**绝对路径**：
   ```
   /absolute/path/to/dsh-mcp-gui-1.0.10.tgz
   ```
4. 安装完成后确认 **MCP 配置** 已启用；刷新页面，侧边栏出现 **MCP**。
5. 如果当前界面的添加插件只接受目录：解压 zip（或 `tar -xzf dsh-mcp-gui-1.0.10.tgz` 得到 `package/`），在添加插件里选择包含 `package.json` 的目录。

## 方式 B：命令行安装

```bash
dsh plugin --profile <profile> add /absolute/path/to/dsh-mcp-gui-1.0.10.tgz
```

`dsh plugin add` 只把包加入 profile 依赖；如果启动后没有自动出现在侧边栏，请在 **设置 → 插件** 中启用 **MCP 配置**，或把 `@local/dsh-mcp-gui` 加入目标 profile 的 `package.json`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@local/dsh-mcp-gui"
      ]
    }
  }
}
```

> 不要手工改 `cordis.patch.yml` 来插入本插件；它的 bundle patch 在包内，插件管理器负责选择和启用。

如果目标机器上的 Agent 有 `plugin_manager` 工具，也可以直接执行：

```
plugin_manager install_bundle target=/absolute/path/to/dsh-mcp-gui-1.0.10.tgz
```

## 离线验证

- 插件包**没有 dependencies / peerDependencies**，`pnpm add` 不需要访问 registry。
- 已在本地用 `pnpm add --offline` 以及一个不可达的 registry（`--registry http://127.0.0.1:1/`）验证：两种方式都能完成安装。
- 安装后未认证访问 `http://127.0.0.1:3080/mcp-gui/api/state` 返回 `401`，说明 Host 路由已挂载；侧边栏出现 `MCP`（order 5）说明客户端模块已注册。

## 升级 / 卸载

- **升级**：用新的 tarball 在插件页覆盖安装；若同一版本已安装，管理器可能返回 `already-installed`，先移除再装。
- **卸载**：设置 → 插件 → 移除 **MCP 配置**。卸载不会自动删除业务数据：
  - 服务定义：`$DSH_HOME/mcp-gui/servers.json`（默认 `~/.dsh/mcp-gui/servers.json`）
  - 凭据：DSH 凭据存储中的 `mcp-gui/<serverId>` 记录
  - 需要彻底清理时手动删除上述数据。

## 校验

Linux/macOS：

```bash
sha256sum -c SHA256SUMS
# macOS 若没有 sha256sum：
shasum -a 256 -c SHA256SUMS
```

## 版本与限制

- 版本：1.0.10；平台：`web`。
- 登录捕获、自签证书、401 刷新重试等行为与包内的 `README.md` 一致。
- 若目标 DSH 升级后不再提供 `@modelcontextprotocol/client`，插件会在连接时报告 SDK 加载失败；此时需要匹配版本的插件包或更新插件。
