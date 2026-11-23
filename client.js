window.__ModuleLoader__.load({
  id: '@local/dsh-mcp-gui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    let ReactDOM
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = undefined
    }
    const createPortal = typeof ReactDOM?.createPortal === 'function' ? ReactDOM.createPortal : (node) => node

    const NS = 'mcpGui'

    const TEXT = {
      zh: {
        panel: '外部系统连接',
        title: '外部系统连接',
        subtitle: '图形化管理外部系统连接（MCP）、认证信息与工具；保存后即可在会话中调用。',
        add: '新增连接',
        refresh: '刷新',
        retry: '重试',
        loading: '正在加载…',
        empty: '还没有外部系统连接。新增一个后可以测试连接并让智能体调用它的工具。',
        emptyAction: '新增第一个外部系统连接',
        edit: '编辑',
        test: '测试连接',
        testing: '测试中…',
        delete: '删除',
        confirmDelete: '确认删除',
        cancel: '取消',
        save: '保存',
        saving: '保存中…',
        saveAndLogin: '保存并打开登录页',
        login: '登录',
        relogin: '重新登录',
        openLogin: '打开登录页并捕获',
        completeLogin: '我已登录，保存当前会话',
        loginWaiting: '等待你在登录页完成登录…',
        loginCaptured: '已捕获认证信息，可以关闭登录页。',
        loginExpired: '登录捕获会话已过期，请重新打开登录页。',
        enabled: '已启用',
        disabled: '已停用',
        tools: '工具',
        noTools: '未列出工具',
        target: '目标',
        auth: '认证',
        authNone: '无登录认证',
        authLogin: '登录捕获',
        authStatic: '静态请求头',
        authCaptured: '已保存',
        authMissing: '未保存',
        authExpired: '已过期，需重新登录',
        authMasked: '凭据',
        capturedAuth: '已捕获的认证信息',
        authStatus: '状态',
        authTokenType: 'Token 类型',
        authAccessToken: 'Access Token',
        authExpiresAt: '过期时间',
        authRefreshToken: 'Refresh Token',
        authScope: 'Scope',
        authClientId: 'Client ID',
        authSource: '捕获来源',
        authRefreshUrl: '刷新地址',
        authRecordKey: '凭据记录',
        authHeaders: '请求头预览',
        authMaskedNote: '完整 token / Cookie 只保存在凭据存储中，界面只显示掩码和长度。',
        authNotCaptured: '尚未捕获认证信息。完成登录后会自动出现。',
        loginDiagnostics: '登录页请求诊断',
        diagNote: '只显示路径，不包含查询串或 token。502/ERR 表示代理连接上游失败，404 表示上游没有该资源；白屏时先看这里哪条资源失败。',
        chars: '字符',
        viewDetails: '查看详情',
        hideDetails: '收起详情',
        basic: '基本信息',
        transport: '传输方式',
        protocolMode: '协议协商',
        protocolAuto: '自动（优先 2026-07-28，回退 2025）',
        protocolLegacy: '兼容 2025（initialize 协商）',
        protocolModern: '强制 2026-07-28',
        protocolHint: '自动：先发 server/discover，支持则用 2026-07-28，否则回退 2025 initialize；兼容：直接走 2025 initialize；强制：只接受 2026-07-28，不支持会明确失败。SSE 传输只支持兼容 2025。',
        stdio: 'stdio（本地命令）',
        sse: 'SSE',
        http: 'HTTP（streamable HTTP）',
        name: '服务名',
        nameHint: '用于工具命名：mcp__<服务名>__<工具名>；仅字母、数字、下划线、短横线，1–32 字符。',
        namePlaceholder: '例如 github',
        enable: '启用此服务',
        url: '地址',
        urlPlaceholder: 'https://example.com/mcp',
        command: '命令',
        commandPlaceholder: '例如 npx',
        args: '参数（每行一个）',
        argsPlaceholder: '-y\n@modelcontextprotocol/server-everything',
        cwd: '工作目录（可选）',
        env: '环境变量',
        addEnv: '添加环境变量',
        headers: '自定义请求头',
        addHeader: '添加请求头',
        headerName: '名称',
        headerValue: '值',
        headerSecret: '敏感',
        headerSavedPlaceholder: '已保存，留空保持不变',
        headerValuePlaceholder: '值',
        remove: '移除',
        authMode: '认证方式',
        authNoneOption: '无登录认证（自定义请求头仍会发送）',
        authLoginOption: '登录页捕获（浏览器登录后自动保存请求头）',
        authStaticOption: '静态令牌 / 请求头',
        loginUrl: '登录页地址',
        loginUrlPlaceholder: 'https://example.com/login',
        refreshUrl: '刷新地址（可选，登录响应带 refresh_token 时使用）',
        refreshUrlPlaceholder: 'https://example.com/oauth/token',
        tokenHeader: '令牌请求头（可选）',
        tokenHeaderHint: '登录响应只有 token、没有 Authorization/Bearer 时，填实际请求头，例如 X-Token。留空则不自动生成认证头。',
        tokenPrefix: '令牌前缀（可选）',
        tokenPrefixHint: '例如 “Bearer ”（带空格）或 “Token ”；留空表示直接发送 token。',
        staticHint: '静态认证使用上面的请求头。请至少填写一个请求头值；敏感值保存后不再回显。',
        loginHint: '点击按钮会打开登录页；在该页完成登录后，插件会自动捕获 Authorization / Cookie / token 并保存。',
        tls: 'TLS 与自签证书',
        tlsMode: '证书校验',
        tlsDefault: '使用系统信任链',
        tlsCa: '信任自定义 CA 证书（PEM）',
        tlsInsecure: '跳过证书校验（不安全）',
        tlsCaLabel: 'CA 证书 PEM',
        tlsCaPlaceholder: '-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----',
        tlsCaFile: '从文件读取',
        tlsInsecureWarning: '跳过证书校验会让连接暴露在中间人攻击下，只应在临时自签环境使用。',
        probeTitle: '测试结果',
        probeSuccess: '连接成功，已列出工具',
        probeSuccessNoTools: '连接成功，但服务没有列出工具',
        probeFailure: '测试失败',
        probeStage: '阶段',
        probeDuration: '耗时',
        probeTools: '工具列表',
        probeServer: '服务端',
        stageConnect: '连接',
        stageTls: 'TLS 证书',
        stageAuth: '认证',
        stageList: '列出工具',
        stageDone: '完成',
        stageCall: '调用',
        errorTitle: '操作失败',
        loginError: '登录捕获失败',
        noticeSaved: '已保存。',
        noticeDeleted: '已删除。',
        noticeEnabled: '已启用。',
        noticeDisabled: '已停用。',
        noticeLoginCaptured: '认证信息已保存。',
        secretStored: '已安全保存',
        secretNotStored: '未保存',
        yes: '是',
        no: '否',
        close: '关闭',
        advanced: '高级选项',
        statusIdle: '未启动',
        statusConnecting: '连接中',
        statusConnected: '已连接',
        statusReconnecting: '重连中',
        statusAuthRequired: '需要登录',
        statusError: '连接失败',
        statusDisabled: '已停用',
        statusClosed: '已关闭',
        expiresAt: '到期时间',
        lastError: '最近错误',
        updatedAt: '更新时间',
        createdAt: '创建时间',
        noExpiry: '未提供过期时间',
        loginInProgress: '有登录捕获会话进行中',
        browse: '选择文件',
        pollError: '读取登录状态失败',
        saveFirst: '请先保存服务，再打开登录页进行捕获。',
        openPopupBlocked: '浏览器拦截了登录页弹窗，请允许弹窗后重试，或点击下面的链接打开：',
        openLink: '打开登录页',
        copied: '已复制',
        copy: '复制',
      },
      en: {
        panel: 'External systems',
        title: 'External system connections',
        subtitle: 'Manage external system connections (MCP), credentials and tools graphically. Saved connections are callable from a session.',
        add: 'Add connection',
        refresh: 'Refresh',
        retry: 'Retry',
        loading: 'Loading…',
        empty: 'No external system connections yet. Add one, test the connection, then ask the agent to use its tools.',
        emptyAction: 'Add the first external system connection',
        edit: 'Edit',
        test: 'Test connection',
        testing: 'Testing…',
        delete: 'Delete',
        confirmDelete: 'Confirm delete',
        cancel: 'Cancel',
        save: 'Save',
        saving: 'Saving…',
        saveAndLogin: 'Save and open login page',
        login: 'Sign in',
        relogin: 'Sign in again',
        openLogin: 'Open login page and capture',
        completeLogin: 'I signed in — save this session',
        loginWaiting: 'Waiting for you to finish signing in on the login page…',
        loginCaptured: 'Credentials captured. You can close the login tab.',
        loginExpired: 'The capture session expired. Open the login page again.',
        enabled: 'Enabled',
        disabled: 'Disabled',
        tools: 'tools',
        noTools: 'No tools listed',
        target: 'Target',
        auth: 'Auth',
        authNone: 'No login auth',
        authLogin: 'Login capture',
        authStatic: 'Static headers',
        authCaptured: 'Saved',
        authMissing: 'Not saved',
        authExpired: 'Expired — sign in again',
        authMasked: 'Credential',
        capturedAuth: 'Captured authentication',
        authStatus: 'Status',
        authTokenType: 'Token type',
        authAccessToken: 'Access token',
        authExpiresAt: 'Expires',
        authRefreshToken: 'Refresh token',
        authScope: 'Scope',
        authClientId: 'Client ID',
        authSource: 'Capture source',
        authRefreshUrl: 'Refresh URL',
        authRecordKey: 'Credential record',
        authHeaders: 'Header preview',
        authMaskedNote: 'Full tokens and cookies stay in the credential store; this page shows only masks and lengths.',
        authNotCaptured: 'No credentials captured yet. They appear after sign-in.',
        loginDiagnostics: 'Login page request diagnostics',
        diagNote: 'Paths only; query strings and tokens are omitted. 502/ERR means the proxy failed to reach upstream; 404 means the asset is missing. Check this list first when the page is blank.',
        chars: 'chars',
        viewDetails: 'Show details',
        hideDetails: 'Hide details',
        basic: 'Basics',
        transport: 'Transport',
        protocolMode: 'Protocol negotiation',
        protocolAuto: 'Auto (prefer 2026-07-28, fall back to 2025)',
        protocolLegacy: 'Compatible 2025 (initialize)',
        protocolModern: 'Force 2026-07-28',
        protocolHint: 'Auto probes server/discover and uses 2026-07-28 when supported, otherwise falls back to the 2025 initialize handshake. Compatible uses the 2025 initialize handshake directly. Force accepts only 2026-07-28 and fails loudly otherwise. SSE supports only Compatible 2025.',
        stdio: 'stdio (local command)',
        sse: 'SSE',
        http: 'HTTP (streamable HTTP)',
        name: 'Server name',
        nameHint: 'Used in tool names: mcp__<server>__<tool>; letters, digits, _ and - only, 1–32 characters.',
        namePlaceholder: 'e.g. github',
        enable: 'Enable this server',
        url: 'URL',
        urlPlaceholder: 'https://example.com/mcp',
        command: 'Command',
        commandPlaceholder: 'e.g. npx',
        args: 'Arguments (one per line)',
        argsPlaceholder: '-y\n@modelcontextprotocol/server-everything',
        cwd: 'Working directory (optional)',
        env: 'Environment',
        addEnv: 'Add variable',
        headers: 'Custom headers',
        addHeader: 'Add header',
        headerName: 'Name',
        headerValue: 'Value',
        headerSecret: 'Secret',
        headerSavedPlaceholder: 'Saved — leave blank to keep',
        headerValuePlaceholder: 'Value',
        remove: 'Remove',
        authMode: 'Authentication',
        authNoneOption: 'No login capture (custom headers still apply)',
        authLoginOption: 'Login capture (capture headers after browser sign-in)',
        authStaticOption: 'Static token / headers',
        loginUrl: 'Login page URL',
        loginUrlPlaceholder: 'https://example.com/login',
        refreshUrl: 'Refresh URL (optional, when the login response returns refresh_token)',
        refreshUrlPlaceholder: 'https://example.com/oauth/token',
        tokenHeader: 'Token header (optional)',
        tokenHeaderHint: 'Set the real header when the login response only returns a token without Authorization/Bearer, e.g. X-Token. Leave blank to avoid inventing an auth header.',
        tokenPrefix: 'Token prefix (optional)',
        tokenPrefixHint: 'For example “Bearer ” (with a space) or “Token ”; blank sends the token directly.',
        staticHint: 'Static auth uses the headers above. Fill at least one value; secret values are never shown again.',
        loginHint: 'The button opens the login page. After you sign in, the plugin captures Authorization / Cookie / token automatically.',
        tls: 'TLS and self-signed certificates',
        tlsMode: 'Verification',
        tlsDefault: 'System trust store',
        tlsCa: 'Trust a custom CA certificate (PEM)',
        tlsInsecure: 'Skip certificate verification (insecure)',
        tlsCaLabel: 'CA certificate PEM',
        tlsCaPlaceholder: '-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----',
        tlsCaFile: 'Read from file',
        tlsInsecureWarning: 'Skipping verification exposes the connection to man-in-the-middle attacks. Use only in a temporary self-signed environment.',
        probeTitle: 'Test result',
        probeSuccess: 'Connected and listed tools',
        probeSuccessNoTools: 'Connected, but the server listed no tools',
        probeFailure: 'Test failed',
        probeStage: 'Stage',
        probeDuration: 'Duration',
        probeTools: 'Tools',
        probeServer: 'Server',
        stageConnect: 'Connect',
        stageTls: 'TLS',
        stageAuth: 'Auth',
        stageList: 'List tools',
        stageDone: 'Done',
        stageCall: 'Call',
        errorTitle: 'Operation failed',
        loginError: 'Login capture failed',
        noticeSaved: 'Saved.',
        noticeDeleted: 'Deleted.',
        noticeEnabled: 'Enabled.',
        noticeDisabled: 'Disabled.',
        noticeLoginCaptured: 'Credentials saved.',
        secretStored: 'Stored securely',
        secretNotStored: 'Not stored',
        yes: 'Yes',
        no: 'No',
        close: 'Close',
        advanced: 'Advanced',
        statusIdle: 'Idle',
        statusConnecting: 'Connecting',
        statusConnected: 'Connected',
        statusReconnecting: 'Reconnecting',
        statusAuthRequired: 'Sign-in required',
        statusError: 'Connection failed',
        statusDisabled: 'Disabled',
        statusClosed: 'Closed',
        expiresAt: 'Expires',
        lastError: 'Last error',
        updatedAt: 'Updated',
        createdAt: 'Created',
        noExpiry: 'No expiry provided',
        loginInProgress: 'A login capture is in progress',
        browse: 'Choose file',
        pollError: 'Failed to read login status',
        saveFirst: 'Save the server before opening the login page.',
        openPopupBlocked: 'The browser blocked the login popup. Allow popups and retry, or open this link:',
        openLink: 'Open login page',
        copied: 'Copied',
        copy: 'Copy',
      },
    }

    const C = {
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      bg: 'var(--dsw-alias-bg-base)',
      layer: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      overlay: 'var(--dsw-alias-bg-overlay)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      brand: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    }

    const DIALOG_CSS = `
.dsh-mcp-gui-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center}
.dsh-mcp-gui-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}
.dsh-mcp-gui-dialog-panel{position:relative;z-index:1;display:flex;flex-direction:column;width:760px;max-width:calc(100vw - 48px);max-height:min(800px,calc(100vh - 2 * max(24px,var(--dsh-frame-overlay-top,24px))));border-radius:var(--dsw-radius-panel);overflow:hidden;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}
.dsh-mcp-gui-dialog-panel:focus{outline:none}
.dsh-mcp-gui-dialog-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;height:54px;padding:20px 14px 8px 24px;box-sizing:border-box;flex:none}
.dsh-mcp-gui-dialog-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary)}
@media(hover:hover){.dsh-mcp-gui-dialog-close:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.dsh-mcp-gui-dialog-body{min-height:0;overflow-y:auto;padding:0 24px 8px}
.dsh-mcp-gui-dialog-footer{position:sticky;bottom:0;display:flex;flex-direction:column;gap:8px;padding:12px 0 0;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.dsh-mcp-gui-auth-details{margin-top:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:10px 12px}
.dsh-mcp-gui-auth-details summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600}
.dsh-mcp-gui-auth-grid{display:grid;grid-template-columns:120px minmax(0,1fr);gap:6px 12px;margin-top:10px;font-size:12px;line-height:18px}
.dsh-mcp-gui-auth-grid dt{color:var(--dsw-alias-label-secondary)}
.dsh-mcp-gui-auth-grid dd{margin:0;color:var(--dsw-alias-label-primary);word-break:break-word}
.dsh-mcp-gui-auth-headers{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.dsh-mcp-gui-auth-header{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:8px;font-size:12px;line-height:18px;align-items:center}
.dsh-mcp-gui-auth-header code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:1px 6px;word-break:break-all}
.dsh-mcp-gui-select-trigger{display:inline-flex;align-items:center;gap:12px;width:100%;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
@media(hover:hover){.dsh-mcp-gui-select-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.dsh-mcp-gui-select-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-mcp-gui-select-trigger:disabled{opacity:.55;cursor:not-allowed}
.dsh-mcp-gui-select-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mcp-gui-select-chevron{flex:none;transition:transform .15s}
.dsh-mcp-gui-select-trigger[aria-expanded="true"] .dsh-mcp-gui-select-chevron{transform:rotate(180deg)}
.dsh-mcp-gui-select-menu{position:fixed;z-index:1100;box-sizing:border-box;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-overlay);box-shadow:var(--dsw-elevation-panel);overflow-y:auto;max-height:min(280px,calc(100vh - 32px))}
.dsh-mcp-gui-select-option{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:6px 10px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px;text-align:left;cursor:pointer}
@media(hover:hover){.dsh-mcp-gui-select-option:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.dsh-mcp-gui-select-option[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover);font-weight:500}
.dsh-mcp-gui-select-option:disabled{opacity:.45;cursor:not-allowed}
.dsh-mcp-gui-select-option-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mcp-gui-select-check{flex:none;color:var(--dsw-alias-brand-primary)}
@media(max-width:767px){
.dsh-mcp-gui-overlay{position:absolute;height:100%;background:var(--dsw-alias-bg-layer-2)}
.dsh-mcp-gui-dialog-panel{width:100%;height:100%;max-width:100%;max-height:100%;border-radius:0}
.dsh-mcp-gui-dialog-header{padding-left:20px}
.dsh-mcp-gui-dialog-body{padding:0 20px 8px}
.dsh-mcp-gui-dialog-footer{padding:12px 0 0}
}
`

    const STATUS_COLOR = {
      connected: C.success,
      connecting: C.warn,
      reconnecting: C.warn,
      'auth-required': C.error,
      error: C.error,
      disabled: C.idle,
      closed: C.idle,
      idle: C.idle,
    }

    const STATUS_KEY = {
      connected: 'statusConnected',
      connecting: 'statusConnecting',
      reconnecting: 'statusReconnecting',
      'auth-required': 'statusAuthRequired',
      error: 'statusError',
      disabled: 'statusDisabled',
      closed: 'statusClosed',
      idle: 'statusIdle',
    }

    function statusLabel(server, t) {
      if (server.enabled === false) return t('statusDisabled')
      return t(STATUS_KEY[server.status?.state] ?? 'statusIdle')
    }

    function buttonStyle(kind, disabled) {
      const base = {
        font: 'inherit', fontSize: 13, lineHeight: '20px', padding: '6px 12px', borderRadius: 8,
        border: '1px solid transparent', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap', userSelect: 'none',
      }
      if (kind === 'primary') return { ...base, background: C.brand, color: 'var(--dsw-alias-label-primary-foreground)', borderColor: C.brand }
      if (kind === 'danger') return { ...base, background: 'transparent', color: C.error, borderColor: C.border }
      if (kind === 'ghost') return { ...base, background: 'transparent', color: C.text, borderColor: C.border }
      return { ...base, background: C.layer, color: C.text, borderColor: C.border }
    }

    function inputStyle(extra = {}) {
      return {
        width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
        border: `1px solid ${C.border}`, background: C.layer, color: C.text,
        font: 'inherit', fontSize: 13, lineHeight: '20px', ...extra,
      }
    }

    function cardStyle(extra = {}) {
      return {
        border: `1px solid ${C.border}`, background: C.layer, borderRadius: 12,
        padding: '14px 16px', ...extra,
      }
    }

    async function request(path, options = {}) {
      const method = options.method ?? (options.body === undefined ? 'GET' : 'POST')
      const response = await fetch(`/mcp-gui${path}`, {
        method,
        credentials: 'same-origin',
        headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) {
        const error = new Error(data?.error?.message ?? `HTTP ${response.status}`)
        error.code = data?.error?.code
        error.details = data?.error?.details
        throw error
      }
      return data
    }

    function formatTime(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      try {
        return new Date(value).toLocaleString()
      } catch {
        return ''
      }
    }

    function emptyForm() {
      return {
        id: undefined,
        name: '',
        enabled: true,
        transport: 'streamable-http',
        protocolMode: 'auto',
        url: '',
        command: '',
        argsText: '',
        cwd: '',
        envRows: [],
        headers: [],
        auth: { mode: 'none', loginUrl: '', refreshUrl: '', tokenHeader: '', tokenPrefix: '' },
        tls: { mode: 'default', caPem: '' },
        createdAt: undefined,
        updatedAt: undefined,
      }
    }

    function serverToForm(server) {
      return {
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport,
        protocolMode: server.transport === 'sse' ? 'legacy' : (server.protocolMode ?? 'legacy'),
        url: server.url,
        command: server.command,
        argsText: (server.args ?? []).join('\n'),
        cwd: server.cwd,
        envRows: (server.envKeys ?? []).map((key) => ({ key, value: '', set: server.envSet?.[key] === true })),
        headers: (server.headers ?? []).map((header) => ({
          name: header.name,
          secret: header.secret === true,
          value: header.secret === true ? '' : header.value ?? '',
          set: header.set === true,
        })),
        auth: {
          mode: server.auth?.mode ?? 'none',
          loginUrl: server.auth?.loginUrl ?? '',
          refreshUrl: server.auth?.refreshUrl ?? '',
          tokenHeader: server.auth?.tokenHeader ?? '',
          tokenPrefix: server.auth?.tokenPrefix ?? '',
        },
        tls: {
          mode: server.tls?.mode ?? 'default',
          caPem: server.tls?.caPem ?? '',
        },
        createdAt: server.createdAt,
        updatedAt: server.updatedAt,
      }
    }

    function formToPayload(form) {
      const headerValues = {}
      for (const header of form.headers) {
        const name = header.name.trim()
        if (name !== '' && typeof header.value === 'string' && header.value !== '') headerValues[name] = header.value
      }
      const envValues = {}
      for (const row of form.envRows) {
        if (row.key.trim() !== '' && typeof row.value === 'string' && row.value !== '') envValues[row.key.trim()] = row.value
      }
      return {
        server: {
          id: form.id,
          name: form.name.trim(),
          enabled: form.enabled,
          transport: form.transport,
          protocolMode: form.protocolMode,
          url: form.url.trim(),
          command: form.command.trim(),
          args: form.argsText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== ''),
          cwd: form.cwd.trim(),
          envKeys: form.envRows.map((row) => row.key.trim()).filter((key) => key !== ''),
          headers: form.headers
            .map((header) => ({ name: header.name.trim(), secret: header.secret }))
            .filter((header) => header.name !== ''),
          auth: {
            mode: form.auth.mode,
            loginUrl: form.auth.loginUrl.trim(),
            refreshUrl: form.auth.refreshUrl.trim(),
            tokenHeader: form.auth.tokenHeader.trim(),
            tokenPrefix: form.auth.tokenPrefix,
          },
          tls: {
            mode: form.tls.mode,
            caPem: form.tls.caPem,
          },
        },
        headerValues,
        envValues,
      }
    }

    function Spinner({ size = 14 }) {
      return h('span', {
        'aria-hidden': true,
        style: {
          display: 'inline-block', width: size, height: size, borderRadius: '50%',
          border: '2px solid currentColor', borderRightColor: 'transparent',
          animation: 'dsh-mcp-gui-spin 0.8s linear infinite', verticalAlign: '-2px',
        },
      })
    }

    function Field({ label, hint, children, t }) {
      return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 } },
        h('span', { style: { fontSize: 12, color: C.muted, fontWeight: 600 } }, label),
        children,
        hint ? h('span', { style: { fontSize: 11, lineHeight: '16px', color: C.muted } }, hint) : null,
      )
    }

    function Section({ title, children }) {
      return h('section', { style: { marginBottom: 22 } },
        h('h3', { style: { margin: '0 0 12px', fontSize: 13, fontWeight: 700, letterSpacing: 0.2, color: C.text } }, title),
        children,
      )
    }

    function Icon({ size = 18, active = false }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, style: { display: 'block', color: active ? C.brand : 'currentColor' },
      },
        h('path', { d: 'M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('rect', { x: 4, y: 7, width: 16, height: 12, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M12 11v4M10 13h4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      )
    }

    function Badge({ children, color = C.muted }) {
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, lineHeight: '16px',
          padding: '1px 7px', borderRadius: 999, border: `1px solid ${C.border}`, color, whiteSpace: 'nowrap',
        },
      }, children)
    }

    function AuthInfoRow({ label, value }) {
      return h(React.Fragment, null,
        h('dt', null, label),
        h('dd', null, value),
      )
    }

    function Select({ value, options, onChange, ariaLabel, disabled = false }) {
      const [open, setOpen] = React.useState(false)
      const [rect, setRect] = React.useState(undefined)
      const triggerRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const selected = options.find((option) => option.value === value) ?? options[0]
      const close = (focus = true) => {
        setOpen(false)
        if (focus) triggerRef.current?.focus?.({ preventScroll: true })
      }
      const openMenu = () => {
        if (disabled) return
        const box = triggerRef.current?.getBoundingClientRect()
        if (box !== undefined) setRect(box)
        setOpen(true)
      }
      React.useEffect(() => {
        if (!open) return undefined
        const onPointer = (event) => {
          if (menuRef.current?.contains(event.target) === true) return
          if (triggerRef.current?.contains(event.target) === true) return
          setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close(true)
          } else if (event.key === 'Tab') {
            event.preventDefault()
            close(true)
          }
        }
        const onResize = () => setOpen(false)
        const onScroll = (event) => {
          if (menuRef.current?.contains(event.target) !== true) setOpen(false)
        }
        document.addEventListener('mousedown', onPointer, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('resize', onResize)
        window.addEventListener('scroll', onScroll, true)
        const frame = requestAnimationFrame(() => {
          const selectedOption = menuRef.current?.querySelector('[role="option"][aria-selected="true"]')
            ?? menuRef.current?.querySelector('[role="option"]:not([disabled])')
          selectedOption?.focus?.({ preventScroll: true })
        })
        return () => {
          cancelAnimationFrame(frame)
          document.removeEventListener('mousedown', onPointer, true)
          document.removeEventListener('keydown', onKey, true)
          window.removeEventListener('resize', onResize)
          window.removeEventListener('scroll', onScroll, true)
        }
      }, [open])
      const onMenuKeyDown = (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const items = [...(menuRef.current?.querySelectorAll('[role="option"]:not([disabled])') ?? [])]
        if (items.length === 0) return
        event.preventDefault()
        const current = items.indexOf(document.activeElement)
        let next = current
        if (event.key === 'ArrowDown') next = Math.min(items.length - 1, current + 1)
        else if (event.key === 'ArrowUp') next = Math.max(0, current - 1)
        else if (event.key === 'Home') next = 0
        else next = items.length - 1
        items[next]?.focus()
      }
      const estimatedHeight = Math.min(280, options.length * 38 + 8)
      const spaceBelow = rect === undefined ? 0 : window.innerHeight - rect.bottom - 12
      const spaceAbove = rect === undefined ? 0 : rect.top - 12
      const openUp = rect !== undefined && spaceBelow < Math.min(estimatedHeight, 200) && spaceAbove > spaceBelow
      const maxHeight = Math.max(120, Math.min(280, openUp ? spaceAbove : spaceBelow))
      const menuStyle = rect === undefined ? {} : {
        left: Math.max(12, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 180) - 12)),
        minWidth: Math.max(rect.width, 180),
        maxWidth: 'calc(100vw - 24px)',
        maxHeight,
        ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      }
      return h(React.Fragment, null,
        h('button', {
          ref: triggerRef,
          type: 'button',
          className: 'dsh-mcp-gui-select-trigger',
          disabled,
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          'aria-label': ariaLabel,
          onClick: () => { if (open) close(true); else openMenu() },
        },
          h('span', { className: 'dsh-mcp-gui-select-label' }, selected?.label ?? '—'),
          h('svg', { className: 'dsh-mcp-gui-select-chevron', width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true },
            h('path', { d: 'M3 5l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ),
        ),
        open && rect !== undefined ? createPortal(
          h('div', {
            ref: menuRef,
            className: 'dsh-mcp-gui-select-menu',
            role: 'listbox',
            'aria-label': ariaLabel,
            style: menuStyle,
            onKeyDown: onMenuKeyDown,
          },
            options.map((option) => h('button', {
              key: option.value,
              type: 'button',
              role: 'option',
              'aria-selected': option.value === value,
              disabled: option.disabled === true,
              className: 'dsh-mcp-gui-select-option',
              onClick: () => { close(true); onChange(option.value) },
            },
              h('span', { className: 'dsh-mcp-gui-select-option-label' }, option.label),
              option.value === value ? h('svg', { className: 'dsh-mcp-gui-select-check', width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true },
                h('path', { d: 'M2.5 7.5l3 3 6-6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              ) : null,
            )),
          ),
          document.body,
        ) : null,
      )
    }

    function Toggle({ checked, onChange, label }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
        onClick: () => onChange(!checked),
        style: {
          width: 36, height: 20, padding: 2, borderRadius: 999, border: 'none', cursor: 'pointer',
          background: checked ? C.brand : C.border2, position: 'relative', transition: 'background .15s',
        },
      }, h('span', {
        style: {
          display: 'block', width: 16, height: 16, borderRadius: '50%', background: 'var(--dsw-alias-switch-thumb)',
          transform: checked ? 'translateX(16px)' : 'translateX(0)', transition: 'transform .15s',
        },
      }))
    }

    function ProbeResult({ probe, t, compact = false, live = false }) {
      if (probe === undefined || probe === null) return null
      if (probe.state === 'running') {
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 12, marginTop: 8 } }, h(Spinner), t('testing'))
      }
      if (probe.state === 'error') {
        return h('div', { style: { ...cardStyle({ borderColor: C.error }), marginTop: 10, fontSize: 12, color: C.error, whiteSpace: 'pre-wrap' } }, probe.message)
      }
      const ok = probe.ok === true
      const stage = probe.stage ?? 'done'
      const stageText = {
        connect: t('stageConnect'), tls: t('stageTls'), auth: t('stageAuth'), list: t('stageList'), done: t('stageDone'), call: t('stageCall'),
      }[stage] ?? stage
      return h('div', {
        ...(live ? { role: 'status', 'aria-live': 'polite' } : {}),
        style: {
          ...cardStyle({ borderColor: ok ? C.border : C.error }),
          marginTop: 10, fontSize: 12, lineHeight: '18px', color: C.text,
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 700, color: ok ? C.success : C.error } },
            ok ? (probe.toolNames?.length ? t('probeSuccess') : t('probeSuccessNoTools')) : t('probeFailure')),
          !ok ? h(Badge, { color: C.error }, `${t('probeStage')}: ${stageText}`) : null,
          h(Badge, null, `${t('probeDuration')}: ${probe.durationMs ?? 0} ms`),
          probe.protocolVersion ? h(Badge, null, `MCP ${probe.protocolVersion}`) : null,
          probe.serverInfo ? h(Badge, null, `${t('probeServer')}: ${probe.serverInfo.name} ${probe.serverInfo.version}`) : null,
        ),
        !ok ? h('pre', {
          style: {
            margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            font: 'inherit', color: C.error, maxHeight: compact ? 120 : 240, overflow: 'auto',
          },
        }, probe.message) : null,
        ok && probe.toolNames?.length
          ? h('div', { style: { marginTop: 8 } },
              h('div', { style: { color: C.muted, marginBottom: 4 } }, `${t('probeTools')} (${probe.toolNames.length})`),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                probe.toolNames.slice(0, 40).map((name) => h(Badge, { key: name }, name)),
                probe.toolNames.length > 40 ? h(Badge, null, `+${probe.toolNames.length - 40}`) : null,
              ),
            )
          : null,
      )
    }

    function ServerCard({ server, t, onEdit, onTest, onToggle, onDelete, onLogin, deleting, setDeleting, test, busy }) {
      const state = server.enabled === false ? 'disabled' : server.status?.state ?? 'idle'
      const color = STATUS_COLOR[state] ?? C.idle
      const authMode = server.auth?.mode ?? 'none'
      const authLabel = authMode === 'login' ? t('authLogin') : authMode === 'static' ? t('authStatic') : t('authNone')
      const authState = server.auth?.status === 'expired' ? t('authExpired') : server.auth?.status === 'captured' ? t('authCaptured') : t('authMissing')
      const authSummary = authMode === 'none' ? t('authNone') : `${authLabel} · ${authState}`
      const testing = busy === `${server.id}:test`
      const target = server.transport === 'stdio'
        ? [server.command, ...(server.args ?? [])].join(' ')
        : server.url
      return h('div', { style: cardStyle({ display: 'flex', flexDirection: 'column', gap: 10 }) },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' } },
          h('span', { style: { width: 9, height: 9, borderRadius: '50%', marginTop: 7, background: color, flex: '0 0 auto' } }),
          h('div', { style: { minWidth: 0, flex: 1 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('span', { style: { fontWeight: 700, fontSize: 14, color: C.text } }, server.name),
              h(Badge, null, server.transport),
              server.status?.protocolVersion ? h(Badge, null, `MCP ${server.status.protocolVersion}`) : null,
              h(Badge, { color }, statusLabel(server, t)),
              server.enabled !== false && server.status?.toolCount > 0 ? h(Badge, null, `${server.status.toolCount} ${t('tools')}`) : null,
              h(Badge, null, `${t('auth')}: ${authSummary}`),
              server.auth?.expiresAt ? h(Badge, null, `${t('expiresAt')}: ${formatTime(server.auth.expiresAt)}`) : null,
              server.auth?.masked ? h(Badge, null, `${t('authMasked')}: ${server.auth.masked}`) : null,
            ),
            h('div', {
              style: { marginTop: 6, fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              title: target,
            }, `${t('target')}: ${target || '—'}`),
            server.status?.state === 'auth-required' || server.auth?.status === 'expired'
              ? h('div', { style: { marginTop: 6, fontSize: 12, color: C.error } }, server.status?.authError || server.auth?.lastError || t('authExpired'))
              : null,
            server.status?.lastError && server.status.state !== 'connected'
              ? h('div', { style: { marginTop: 6, fontSize: 12, color: C.error, whiteSpace: 'pre-wrap' } }, server.status.lastError)
              : null,
          ),
          h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flex: '0 0 auto' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { style: { fontSize: 11, color: C.muted } }, server.enabled ? t('enabled') : t('disabled')),
              h(Toggle, { checked: server.enabled, onChange: (value) => onToggle(server, value), label: server.name }),
            ),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } },
              h('button', { type: 'button', style: buttonStyle('ghost', testing), disabled: testing, onClick: () => onTest(server) },
                testing ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(Spinner), t('testing')) : t('test')),
              h('button', { type: 'button', style: buttonStyle('ghost'), onClick: () => onEdit(server) }, t('edit')),
              authMode === 'login' ? h('button', { type: 'button', style: buttonStyle('ghost'), onClick: () => onLogin(server) }, server.auth?.status === 'captured' ? t('relogin') : t('login')) : null,
              deleting === server.id
                ? h('span', { style: { display: 'inline-flex', gap: 6 } },
                    h('button', { type: 'button', style: buttonStyle('danger'), onClick: () => onDelete(server) }, t('confirmDelete')),
                    h('button', { type: 'button', style: buttonStyle('ghost'), onClick: () => setDeleting(undefined) }, t('cancel')),
                  )
                : h('button', { type: 'button', style: buttonStyle('danger'), onClick: () => setDeleting(server.id) }, t('delete')),
            ),
          ),
        ),
        h(ProbeResult, { probe: test, t, compact: true, live: true }),
      )
    }

    function HeaderRow({ header, index, update, remove, t }) {
      return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } },
        h('input', { 'aria-label': t('headerName'), style: inputStyle({ flex: '1 1 120px', minWidth: 120 }), placeholder: t('headerName'), value: header.name, onChange: (event) => update(index, { name: event.target.value }) }),
        h('input', {
          'aria-label': t('headerValue'), style: inputStyle({ flex: '1 1 180px', minWidth: 160 }), type: header.secret ? 'password' : 'text', autoComplete: 'off',
          placeholder: header.set ? t('headerSavedPlaceholder') : t('headerValuePlaceholder'),
          value: header.value, onChange: (event) => update(index, { value: event.target.value }),
        }),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, whiteSpace: 'nowrap' } },
          h('input', { type: 'checkbox', checked: header.secret, onChange: (event) => update(index, { secret: event.target.checked }) }),
          t('headerSecret'),
        ),
        h('button', { type: 'button', style: buttonStyle('ghost'), onClick: () => remove(index) }, t('remove')),
      )
    }

    function EnvRow({ row, index, update, remove, t }) {
      return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } },
        h('input', { 'aria-label': t('env'), style: inputStyle({ flex: '1 1 140px', minWidth: 140 }), placeholder: 'TOKEN', value: row.key, onChange: (event) => update(index, { key: event.target.value }) }),
        h('input', {
          'aria-label': t('headerValue'), style: inputStyle({ flex: '1 1 180px', minWidth: 160 }), type: 'password', autoComplete: 'off',
          placeholder: row.set ? t('headerSavedPlaceholder') : t('headerValuePlaceholder'),
          value: row.value, onChange: (event) => update(index, { value: event.target.value }),
        }),
        h('button', { type: 'button', style: buttonStyle('ghost'), onClick: () => remove(index) }, t('remove')),
      )
    }

    function EditDialog({ server, t, onClose, onSaved, refresh, loginRequest, setLoginRequest }) {
      const [form, setForm] = React.useState(() => server ? serverToForm(server) : emptyForm())
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [probe, setProbe] = React.useState(undefined)
      const [login, setLogin] = React.useState(undefined)
      const [authInfo, setAuthInfo] = React.useState(server?.auth)
      const fileRef = React.useRef(null)
      const dialogRef = React.useRef(null)
      const openerRef = React.useRef(document.activeElement)
      React.useEffect(() => {
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { document.body.style.overflow = previous }
      }, [])

      const closeRef = React.useRef(onClose)
      closeRef.current = onClose
      React.useEffect(() => {
        const onKey = (event) => {
          if (document.querySelector('.dsh-mcp-gui-select-menu') !== null) return
          if (event.key === 'Escape') {
            event.preventDefault()
            closeRef.current?.()
            return
          }
          if (event.key !== 'Tab') return
          const dialog = dialogRef.current
          if (dialog === null) return
          const focusables = [...dialog.querySelectorAll('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')]
            .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
          if (focusables.length === 0) return
          const first = focusables[0]
          const last = focusables[focusables.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [])

      React.useLayoutEffect(() => {
        const field = dialogRef.current?.querySelector('input,select,textarea')
        const target = field ?? dialogRef.current?.querySelector('button')
        target?.focus?.()
        return () => {
          const opener = openerRef.current
          if (opener instanceof HTMLElement && opener.isConnected && typeof opener.focus === 'function') opener.focus()
        }
      }, [])

      // Poll a capture session started from this dialog or from a row action.
      const loginId = login?.id ?? (loginRequest?.serverId === form.id ? loginRequest?.id : undefined)
      React.useEffect(() => {
        if (loginId === undefined) return undefined
        let alive = true
        let timer
        let stopped = false
        const tick = async () => {
          if (stopped) return
          try {
            const data = await request(`/api/login/status?id=${encodeURIComponent(loginId)}`)
            if (!alive) return
            setLogin((current) => ({ ...(current ?? { id: loginId }), ...data.status }))
            if (data.status.auth !== undefined) setAuthInfo(data.status.auth)
            if (data.status.status === 'captured' || data.status.status === 'error') {
              stopped = true
              clearInterval(timer)
              if (data.status.status === 'captured') {
                refresh()
                setProbe(undefined)
              }
            }
          } catch (failure) {
            if (alive) {
              stopped = true
              clearInterval(timer)
              const message = /过期|不存在/.test(failure.message) ? t('loginExpired') : failure.message
              setLogin((current) => ({ ...(current ?? { id: loginId }), status: 'error', error: message }))
            }
          }
        }
        void tick()
        timer = setInterval(tick, 1200)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [loginId, refresh])

      const update = (patch) => setForm((current) => ({ ...current, ...patch }))
      const updateAuth = (patch) => setForm((current) => ({ ...current, auth: { ...current.auth, ...patch } }))
      const updateTls = (patch) => setForm((current) => ({ ...current, tls: { ...current.tls, ...patch } }))
      const updateHeader = (index, patch) => setForm((current) => {
        const headers = current.headers.slice()
        headers[index] = { ...headers[index], ...patch }
        return { ...current, headers }
      })
      const removeHeader = (index) => setForm((current) => ({ ...current, headers: current.headers.filter((_, i) => i !== index) }))
      const updateEnv = (index, patch) => setForm((current) => {
        const envRows = current.envRows.slice()
        envRows[index] = { ...envRows[index], ...patch }
        return { ...current, envRows }
      })
      const removeEnv = (index) => setForm((current) => ({ ...current, envRows: current.envRows.filter((_, i) => i !== index) }))

      const payload = () => formToPayload(form)

      const save = async () => {
        setBusy('save')
        setError('')
        try {
          const data = await request('/api/servers', { body: payload() })
          if (data.server?.auth !== undefined) setAuthInfo(data.server.auth)
          return data.server
        } catch (failure) {
          setError(failure.message)
          return undefined
        } finally {
          setBusy('')
        }
      }

      const test = async () => {
        setBusy('test')
        setProbe({ state: 'running' })
        setError('')
        try {
          const data = await request('/api/probe', { body: payload() })
          setProbe({ state: 'done', ...data.probe })
        } catch (failure) {
          setProbe({ state: 'error', message: failure.message })
        } finally {
          setBusy('')
        }
      }

      const startLogin = async (popup) => {
        setError('')
        try {
          const saved = await save()
          if (saved === undefined) {
            popup?.close?.()
            return
          }
          update({ id: saved.id })
          refresh()
          setBusy('login')
          const data = await request('/api/login/start', { body: { id: saved.id } })
          setLogin({ id: data.id, status: 'waiting', url: data.url })
          setLoginRequest({ id: data.id, serverId: saved.id })
          if (popup && !popup.closed) popup.location.href = data.url
          else window.open(data.url, '_blank', 'noopener,noreferrer')
          if (popup === null) setError(t('openPopupBlocked'))
        } catch (failure) {
          popup?.close?.()
          setError(failure.message)
        } finally {
          setBusy('')
        }
      }

      const openLogin = () => {
        const popup = window.open('about:blank', '_blank')
        void startLogin(popup)
      }

      const completeLogin = async () => {
        if (login?.id === undefined) return
        setBusy('complete')
        setError('')
        try {
          const data = await request('/api/login/complete', { body: { id: login.id } })
          setLogin((current) => ({ ...(current ?? {}), ...data.status }))
          if (data.status.auth !== undefined) setAuthInfo(data.status.auth)
          refresh()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy('')
        }
      }

      const cancelLogin = async () => {
        if (login?.id === undefined) return
        try {
          await request('/api/login/cancel', { body: { id: login.id } })
        } catch {
          // The session may already have expired; closing the local view is enough.
        }
        setLogin(undefined)
        setLoginRequest(undefined)
      }

      const readCaFile = (event) => {
        const file = event.target.files?.[0]
        if (file === undefined) return
        const reader = new FileReader()
        reader.onload = () => updateTls({ caPem: String(reader.result ?? '') })
        reader.readAsText(file)
      }

      const isStdio = form.transport === 'stdio'
      const showTls = !isStdio
      const authView = authInfo ?? login?.auth ?? server?.auth ?? {}
      const captured = authView.status === 'captured'
        || (typeof authView.accessTokenMasked === 'string' && authView.accessTokenMasked !== '')
        || (Array.isArray(authView.capturedHeaders) && authView.capturedHeaders.length > 0)

      return createPortal(
        h('div', { className: 'dsh-mcp-gui-overlay', role: 'presentation' },
          h('div', { className: 'dsh-mcp-gui-mask', 'aria-hidden': true, onClick: onClose }),
          h('div', {
            ref: dialogRef,
            tabIndex: -1,
            role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mcp-gui-dialog-title',
            className: 'dsh-mcp-gui-dialog-panel',
          },
            h('div', { className: 'dsh-mcp-gui-dialog-header' },
              h('h2', { id: 'mcp-gui-dialog-title', style: { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 } }, server ? `${t('edit')} · ${server.name}` : t('add')),
              h('button', { type: 'button', className: 'dsh-mcp-gui-dialog-close', onClick: onClose, 'aria-label': t('close') },
                h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true },
                  h('path', { d: 'M3 3l8 8M11 3l-8 8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
                ),
              ),
            ),
            h('div', { className: 'dsh-mcp-gui-dialog-body' },
              h('div', { style: { fontSize: 12, lineHeight: '18px', color: C.muted, margin: '0 0 14px' } }, t('subtitle')),
              error ? h('div', {
            role: 'alert', 'aria-live': 'assertive',
            style: { ...cardStyle({ borderColor: C.error }), color: C.error, fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 14 },
          }, `${t('errorTitle')}: ${error}`) : null,
          h(Section, { title: t('basic') },
            h(Field, { label: t('name'), hint: t('nameHint'), t },
              h('input', { style: inputStyle(), placeholder: t('namePlaceholder'), value: form.name, onChange: (event) => update({ name: event.target.value }) }),
            ),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
              h('input', { type: 'checkbox', checked: form.enabled, onChange: (event) => update({ enabled: event.target.checked }) }),
              t('enable'),
            ),
          ),
          h(Section, { title: t('transport') },
            h(Field, { label: t('transport'), t },
              h(Select, {
                value: form.transport,
                ariaLabel: t('transport'),
                options: [
                  { value: 'streamable-http', label: t('http') },
                  { value: 'sse', label: t('sse') },
                  { value: 'stdio', label: t('stdio') },
                ],
                onChange: (transport) => {
                  update({
                    transport,
                    ...(transport === 'stdio' && form.auth.mode !== 'none' ? { auth: { ...form.auth, mode: 'none' } } : {}),
                    ...(transport === 'sse' ? { protocolMode: 'legacy' } : {}),
                  })
                },
              }),
            ),
            h(Field, { label: t('protocolMode'), hint: t('protocolHint'), t },
              h(Select, {
                value: form.protocolMode,
                ariaLabel: t('protocolMode'),
                options: [
                  { value: 'auto', label: t('protocolAuto'), disabled: form.transport === 'sse' },
                  { value: 'legacy', label: t('protocolLegacy') },
                  { value: '2026-07-28', label: t('protocolModern'), disabled: form.transport === 'sse' },
                ],
                onChange: (protocolMode) => update({ protocolMode }),
              }),
            ),
            isStdio ? h('div', null,
              h(Field, { label: t('command'), t },
                h('input', { style: inputStyle(), placeholder: t('commandPlaceholder'), value: form.command, onChange: (event) => update({ command: event.target.value }) }),
              ),
              h(Field, { label: t('args'), t },
                h('textarea', { style: inputStyle({ minHeight: 72, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }), placeholder: t('argsPlaceholder'), value: form.argsText, onChange: (event) => update({ argsText: event.target.value }) }),
              ),
              h(Field, { label: t('cwd'), t },
                h('input', { style: inputStyle(), value: form.cwd, onChange: (event) => update({ cwd: event.target.value }) }),
              ),
              h(Field, { label: t('env'), t },
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  form.envRows.map((row, index) => h(EnvRow, { key: index, row, index, update: updateEnv, remove: removeEnv, t })),
                  h('button', { type: 'button', style: buttonStyle('ghost'), onClick: () => update({ envRows: [...form.envRows, { key: '', value: '', set: false }] }) }, t('addEnv')),
                ),
              ),
            ) : h(Field, { label: t('url'), t },
              h('input', { style: inputStyle(), placeholder: t('urlPlaceholder'), value: form.url, onChange: (event) => update({ url: event.target.value }) }),
            ),
          ),
          h(Section, { title: t('headers') },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              form.headers.map((header, index) => h(HeaderRow, { key: index, header, index, update: updateHeader, remove: removeHeader, t })),
              h('button', { type: 'button', style: buttonStyle('ghost'), onClick: () => update({ headers: [...form.headers, { name: '', secret: true, value: '', set: false }] }) }, t('addHeader')),
            ),
          ),
          h(Section, { title: t('authMode') },
            h(Field, { label: t('authMode'), t },
              h(Select, {
                value: form.auth.mode,
                ariaLabel: t('authMode'),
                options: [
                  { value: 'none', label: t('authNoneOption') },
                  { value: 'login', label: t('authLoginOption'), disabled: isStdio },
                  { value: 'static', label: t('authStaticOption'), disabled: isStdio },
                ],
                onChange: (mode) => updateAuth({ mode }),
              }),
            ),
            form.auth.mode === 'login' ? h('div', null,
              h(Field, { label: t('loginUrl'), hint: t('loginHint'), t },
                h('input', { style: inputStyle(), placeholder: t('loginUrlPlaceholder'), value: form.auth.loginUrl, onChange: (event) => updateAuth({ loginUrl: event.target.value }) }),
              ),
              h('details', { className: 'dsh-mcp-gui-auth-details' },
                h('summary', null, t('advanced')),
                h('div', { style: { marginTop: 10 } },
                  h(Field, { label: t('refreshUrl'), t },
                    h('input', { style: inputStyle(), placeholder: t('refreshUrlPlaceholder'), value: form.auth.refreshUrl, onChange: (event) => updateAuth({ refreshUrl: event.target.value }) }),
                  ),
                  h(Field, { label: t('tokenHeader'), hint: t('tokenHeaderHint'), t },
                    h('input', { style: inputStyle(), placeholder: 'X-Token / Authorization', value: form.auth.tokenHeader, onChange: (event) => updateAuth({ tokenHeader: event.target.value }) }),
                  ),
                  h(Field, { label: t('tokenPrefix'), hint: t('tokenPrefixHint'), t },
                    h('input', { style: inputStyle(), placeholder: 'Bearer ', value: form.auth.tokenPrefix, onChange: (event) => updateAuth({ tokenPrefix: event.target.value }) }),
                  ),
                  h('div', { style: { marginTop: 12, fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 } }, t('capturedAuth')),
                  captured ? h('div', null,
                    h('dl', { className: 'dsh-mcp-gui-auth-grid' },
                      h(AuthInfoRow, { key: 'status', label: t('authStatus'), value: authView.status === 'captured' ? t('authCaptured') : (authView.status || '—') }),
                      h(AuthInfoRow, { key: 'token-type', label: t('authTokenType'), value: authView.tokenType || '—' }),
                      h(AuthInfoRow, { key: 'access-token', label: t('authAccessToken'), value: authView.accessTokenMasked || '—' }),
                      h(AuthInfoRow, { key: 'expires-at', label: t('authExpiresAt'), value: authView.expiresAt ? formatTime(authView.expiresAt) : t('noExpiry') }),
                      h(AuthInfoRow, { key: 'refresh-token', label: t('authRefreshToken'), value: authView.refreshTokenPresent ? t('yes') : t('no') }),
                      h(AuthInfoRow, { key: 'scope', label: t('authScope'), value: authView.scope || '—' }),
                      h(AuthInfoRow, { key: 'client-id', label: t('authClientId'), value: authView.clientId || '—' }),
                      h(AuthInfoRow, { key: 'source', label: t('authSource'), value: authView.source || '—' }),
                      h(AuthInfoRow, { key: 'refresh-url', label: t('authRefreshUrl'), value: authView.refreshUrl || form.auth.refreshUrl || '—' }),
                      h(AuthInfoRow, { key: 'record-key', label: t('authRecordKey'), value: authView.recordKey || '—' }),
                    ),
                    Array.isArray(authView.capturedHeaders) && authView.capturedHeaders.length > 0 ? h('div', null,
                      h('div', { style: { marginTop: 12, fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 } }, t('authHeaders')),
                      h('div', { className: 'dsh-mcp-gui-auth-headers' },
                        authView.capturedHeaders.map((header) => h('div', { key: header.name, className: 'dsh-mcp-gui-auth-header' },
                          h('span', { style: { color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, header.name),
                          h('code', null, header.masked || '—'),
                          h('span', { style: { color: C.muted, textAlign: 'right', whiteSpace: 'nowrap' } }, `${header.length} ${t('chars')}`),
                        )),
                      ),
                    ) : null,
                    h('div', { style: { marginTop: 10, fontSize: 11, lineHeight: '16px', color: C.muted } }, t('authMaskedNote')),
                  ) : h('div', { style: { fontSize: 12, color: C.muted, lineHeight: '18px' } }, t('authNotCaptured')),
                  Array.isArray(login?.requests) && login.requests.length > 0 ? h('div', { style: { marginTop: 14 } },
                    h('div', { style: { fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 } }, t('loginDiagnostics')),
                    h('div', { className: 'dsh-mcp-gui-auth-headers' },
                      login.requests.map((request, index) => h('div', { key: index, className: 'dsh-mcp-gui-auth-header' },
                        h('span', { style: { color: C.muted, wordBreak: 'break-all' } }, `${request.method} ${request.path}`),
                        h('span', { title: request.error, style: { color: request.error !== undefined || request.status >= 400 ? C.error : C.success, textAlign: 'right' } }, request.error !== undefined ? `ERR ${request.status || ''}`.trim() : String(request.status)),
                        h('span', { style: { color: C.muted, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, request.contentType || '—'),
                      )),
                    ),
                    h('div', { style: { marginTop: 8, fontSize: 11, lineHeight: '16px', color: C.muted } }, t('diagNote')),
                  ) : null,
                ),
              ),
              h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 } },
                h('button', { type: 'button', style: buttonStyle('primary', busy === 'login'), disabled: busy === 'login' || form.auth.loginUrl.trim() === '', onClick: openLogin },
                  busy === 'login' ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(Spinner), t('saving')) : t('saveAndLogin')),
                login?.status === 'waiting' ? h('button', { type: 'button', style: buttonStyle('ghost'), disabled: busy === 'complete', onClick: completeLogin }, t('completeLogin')) : null,
                login?.status === 'waiting' ? h('button', { type: 'button', style: buttonStyle('ghost'), onClick: cancelLogin }, t('cancel')) : null,
                login?.url ? h('a', { href: login.url, target: '_blank', rel: 'noopener noreferrer', style: { fontSize: 12, color: C.brand } }, t('openLink')) : null,
                server?.auth?.status === 'captured' && login === undefined ? h(Badge, { color: C.success }, `${t('authCaptured')} · ${server.auth.masked || ''}`) : null,
                server?.auth?.status === 'expired' && login === undefined ? h(Badge, { color: C.error }, t('authExpired')) : null,
              ),
              login ? h('div', { role: 'status', 'aria-live': 'polite', style: { marginTop: 8, fontSize: 12, color: login.status === 'captured' ? C.success : login.status === 'error' ? C.error : C.muted, whiteSpace: 'pre-wrap' } },
                login.status === 'captured' ? t('loginCaptured') : login.status === 'error' ? `${t('loginError')}: ${login.error ?? ''}` : t('loginWaiting'),
              ) : null,
            ) : null,
            form.auth.mode === 'static' ? h('div', { style: { fontSize: 12, color: C.muted, lineHeight: '18px' } }, t('staticHint')) : null,
          ),
          showTls ? h(Section, { title: t('tls') },
            h(Field, { label: t('tlsMode'), t },
              h(Select, {
                value: form.tls.mode,
                ariaLabel: t('tlsMode'),
                options: [
                  { value: 'default', label: t('tlsDefault') },
                  { value: 'ca', label: t('tlsCa') },
                  { value: 'insecure', label: t('tlsInsecure') },
                ],
                onChange: (mode) => updateTls({ mode }),
              }),
            ),
            form.tls.mode === 'insecure' ? h('div', { style: { fontSize: 12, color: C.error, lineHeight: '18px' } }, t('tlsInsecureWarning')) : null,
            form.tls.mode === 'ca' ? h('div', null,
              h(Field, { label: t('tlsCaLabel'), t },
                h('textarea', {
                  style: inputStyle({ minHeight: 130, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }),
                  placeholder: t('tlsCaPlaceholder'), value: form.tls.caPem, onChange: (event) => updateTls({ caPem: event.target.value }),
                }),
              ),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h('input', { ref: fileRef, type: 'file', accept: '.pem,.crt,.cer,text/plain', style: { display: 'none' }, onChange: readCaFile }),
                h('button', { type: 'button', style: buttonStyle('ghost'), onClick: () => fileRef.current?.click() }, t('tlsCaFile')),
              ),
            ) : null,
          ) : null,
          h('div', { className: 'dsh-mcp-gui-dialog-footer', style: { marginTop: 12 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } },
              h('button', { type: 'button', style: buttonStyle('ghost', busy === 'test'), disabled: busy !== '', onClick: test }, t('test')),
              h('button', { type: 'button', style: buttonStyle('primary', busy === 'save'), disabled: busy !== '', onClick: async () => { const saved = await save(); if (saved !== undefined) onSaved(saved) } },
                busy === 'save' ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(Spinner), t('saving')) : t('save')),
              h('button', { type: 'button', style: buttonStyle('ghost'), onClick: onClose }, t('cancel')),
            ),
            h(ProbeResult, { probe, t, live: true }),
          ),
            ),
          ),
        ),
        document.body,
      )
    }

    function App({ t }) {
      const [state, setState] = React.useState({ loading: true, servers: [], loginSessions: [] })
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [editing, setEditing] = React.useState(undefined)
      const [deleting, setDeleting] = React.useState(undefined)
      const [tests, setTests] = React.useState({})
      const [busy, setBusy] = React.useState('')
      const [loginRequest, setLoginRequest] = React.useState(undefined)

      const refresh = React.useCallback(async () => {
        try {
          const data = await request('/api/state')
          setState({ loading: false, servers: data.servers ?? [], loginSessions: data.loginSessions ?? [] })
        } catch (failure) {
          setState((current) => ({ ...current, loading: false }))
          setError((current) => current || failure.message)
        }
      }, [])

      React.useEffect(() => {
        void refresh()
        const timer = setInterval(refresh, 2500)
        return () => clearInterval(timer)
      }, [refresh])

      const flash = (message) => {
        setNotice(message)
        setTimeout(() => setNotice((current) => (current === message ? '' : current)), 4000)
      }

      const testServer = async (server) => {
        setError('')
        setBusy(`${server.id}:test`)
        setTests((current) => ({ ...current, [server.id]: { state: 'running' } }))
        try {
          const data = await request('/api/probe', { body: { id: server.id } })
          setTests((current) => ({ ...current, [server.id]: { state: 'done', ...data.probe } }))
        } catch (failure) {
          setTests((current) => ({ ...current, [server.id]: { state: 'error', message: failure.message } }))
        } finally {
          setBusy('')
        }
      }

      const toggleServer = async (server, enabled) => {
        setError('')
        setBusy(`${server.id}:toggle`)
        try {
          await request('/api/servers/enable', { body: { id: server.id, enabled } })
          flash(enabled ? t('noticeEnabled') : t('noticeDisabled'))
          await refresh()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy('')
        }
      }

      const deleteServer = async (server) => {
        setError('')
        setBusy(`${server.id}:delete`)
        try {
          await request('/api/servers/delete', { body: { id: server.id } })
          setDeleting(undefined)
          flash(t('noticeDeleted'))
          await refresh()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy('')
        }
      }

      const startLogin = async (server) => {
        setError('')
        const popup = window.open('about:blank', '_blank')
        if (popup === null) setError(t('openPopupBlocked'))
        try {
          const data = await request('/api/login/start', { body: { id: server.id } })
          setLoginRequest({ id: data.id, serverId: server.id })
          setEditing({ server })
          if (popup && !popup.closed) popup.location.href = data.url
          else window.open(data.url, '_blank', 'noopener,noreferrer')
          if (popup === null) setError(t('openPopupBlocked'))
          flash(t('loginWaiting'))
        } catch (failure) {
          popup?.close?.()
          setError(failure.message)
        }
      }

      const onSaved = async (server) => {
        setError('')
        setEditing(undefined)
        flash(t('noticeSaved'))
        await refresh()
      }

      return h('div', {
        'data-mcp-gui': '',
        style: {
          height: '100%', overflow: 'auto', background: C.bg, color: C.text,
          padding: 'calc(26px + var(--dsh-frame-top-clearance, 0px)) clamp(16px, 4vw, 32px) 64px', boxSizing: 'border-box',
        },
      },
        h('style', null, '@keyframes dsh-mcp-gui-spin{to{transform:rotate(360deg)}} @media (max-width: 767px){[data-mcp-gui] input,[data-mcp-gui] select,[data-mcp-gui] textarea{font-size:16px !important}}'),
        h('style', null, DIALOG_CSS),
        h('div', { style: { maxWidth: 1080, margin: '0 auto' } },
          h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' } },
            h('div', null,
              h('h1', { style: { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600 } }, t('title')),
              h('p', { style: { margin: '6px 0 0', fontSize: 13, lineHeight: '20px', color: C.muted, maxWidth: 720 } }, t('subtitle')),
            ),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } },
              h('button', { type: 'button', style: buttonStyle('ghost'), onClick: refresh }, t('refresh')),
              h('button', { type: 'button', style: buttonStyle('primary'), onClick: () => setEditing({ server: undefined }) }, t('add')),
            ),
          ),
          notice ? h('div', { role: 'status', 'aria-live': 'polite', style: { ...cardStyle(), borderColor: C.brand, fontSize: 12, color: C.text, marginBottom: 14 } }, notice) : null,
          error ? h('div', { role: 'alert', 'aria-live': 'assertive', style: { ...cardStyle({ borderColor: C.error }), color: C.error, fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 14 } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
              h('span', null, `${t('errorTitle')}: ${error}`),
              h('button', { type: 'button', style: buttonStyle('ghost'), onClick: () => { setError(''); void refresh() } }, t('retry')),
            ),
          ) : null,
          state.loading ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, color: C.muted, fontSize: 13 } }, h(Spinner, { size: 16 }), t('loading'))
            : state.servers.length === 0
              ? (error === '' ? h('div', { style: cardStyle({ textAlign: 'center', padding: '40px 20px' }) },
                  h('div', { style: { fontSize: 14, color: C.text, marginBottom: 6 } }, t('empty')),
                  h('button', { type: 'button', style: buttonStyle('primary'), onClick: () => setEditing({ server: undefined }) }, t('emptyAction')),
                ) : null)
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                  state.servers.map((server) => h(ServerCard, {
                    key: server.id,
                    server,
                    t,
                    onEdit: (item) => setEditing({ server: item }),
                    onTest: testServer,
                    onToggle: toggleServer,
                    onDelete: deleteServer,
                    onLogin: startLogin,
                    deleting,
                    setDeleting,
                    test: tests[server.id],
                    busy,
                  })),
                ),
          state.loginSessions.length > 0
            ? h('div', { style: { marginTop: 16, fontSize: 12, color: C.muted } }, `${t('loginInProgress')}: ${state.loginSessions.length}`)
            : null,
        ),
        editing ? h(EditDialog, {
          key: editing.server?.id ?? 'new',
          server: editing.server,
          t,
          onClose: () => { setEditing(undefined); setLoginRequest(undefined) },
          onSaved,
          refresh,
          loginRequest,
          setLoginRequest,
        }) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, TEXT), 'mcp-gui: dictionaries')
        const t = ctx.locale.bind(NS)
        const Panel = (props) => h(App, { ...props, t })
        const PanelIcon = (props) => h(Icon, props)
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'mcp-gui',
          locale: NS,
        }, Panel))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'mcp-gui',
          order: 5,
          label: () => t('panel'),
          locale: NS,
        }, PanelIcon))
      },
    }
  },
})
