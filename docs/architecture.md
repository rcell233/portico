# 架构

## 进程边界

- 主进程管理 SSH、加密存储、命令执行、代理和原生网页视图。
- preload 只暴露列举的固定 IPC 方法。每个调用校验 sender 和 mainFrame，主进程使用 Zod 再验证参数。
- React 工作空间只加载本地界面；禁止导航和新窗口，开启 sandbox / contextIsolation，禁用 Node integration。
- 远程 WebContentsView 没有 preload，与工作空间完全隔离。每个应用有独立 `persist:service-<UUID>` 会话。

## SSH

本机配置主机保存 `sshAlias`，直接运行 `/usr/bin/ssh`，由 OpenSSH 解析原始配置并处理 ProxyCommand、ProxyJump、身份、算法和 known_hosts。Portico 使用权限 0700 临时目录中的独立 ControlMaster 套接字复用连接。网页通道使用 `ssh -W` 标准输入输出，命令使用复用会话；子会话禁止控制连接消失后另建直连。`ssh -G` 只提供选择列表的展示摘要。

SSH_ASKPASS 通过带随机凭据的私有 Unix 套接字请求独立沙箱模态窗口；口令只在内存中交给 SSH 子进程，不存盘。macOS 从用户登录 shell 加载环境，使 Finder 启动也能找到用户的代理命令。Portico 覆盖连接复用、后台化、TTY、RemoteCommand 和额外转发选项，以便只管理应用所需通道。

手动配置主机仍使用 ssh2 Client 与保存的跳板关系。两种模式都合并并发连接，网页与远程命令共享连接。

手动主机首次连接由用户核对 SHA-256 指纹并保存。记录按目标 SSH 地址与端口索引；变化后拒绝连接，不自动覆盖。初次认证错误由用户处理；已建立的连接中断后指数退避重连，主动断开会取消重试。

## 内嵌网页与代理

每个应用使用独立的 HTTP 代理，监听 `127.0.0.1` 随机端口。代理认证使用每次运行随机生成的 256-bit 凭据，由 Electron login 回调提供，凭据不会发给远端页面或写入配置。

代理限定目标为该应用配置的地址和端口。HTTP 流、HTTP Upgrade 与 CONNECT 均通过 SSH 通道传输；Chromium 的普通 WebSocket 也使用 CONNECT。HTTPS 在 Chromium 与远端之间验证证书。

代理是本机认证边界，并非针对同用户恶意进程的 OS 级隔离。它不监听局域网，也不提供无认证的服务端口。使用固定代理配置和 loopback 代理规则，没有直连回退。

页面只允许配置地址内的导航和资源请求。外部 SSO / CDN / 跨端口资源暂不支持。新窗口请求转为同一应用内的合法导航，权限请求默认拒绝，文件下载由原生保存对话框处理。

## 持久化

整个工作空间（包括密码、私钥口令、应用 token、环境变量和已信任指纹）使用 Electron safeStorage 加密后写入 `workspace.enc`。权限 0600，串行原子写入。无法解密时保留原文件并明确报错。Linux `basic_text` 不被接受。

## 远端服务生命周期

流程：连接 SSH → HTTP 健康检查 → 必要时启动 → 等待就绪 → 展示网页。

启动脚本使用 Linux Python 3：

- 应用 UUID 对应独立目录，fcntl 文件锁避免跨窗口/客户端重复启动。
- 优先复用已有托管进程或端口监听者。
- Popen(start_new_session=True) 启动 Bash 前台命令，stdin 断开、输出写入权限 0600 日志，SSH 断开不影响进程。
- 元数据记录 PID 和 `/proc/<pid>/stat` 的出生时间；`PORTICO_SERVICE_ID` 标记进程所属应用。
- 停止前同时验证元数据和 `/proc/<pid>/environ` 标记，再向对应进程组发送 SIGTERM。不会自动 SIGKILL，也不会杀死外部启动的进程。
- 用户关闭页面只取消本地等待和代理；已启动的远端进程保留。

健康检查支持路径、预期响应文本、超时。已有监听者检查不通过时拒绝重复启动。日志只读取末尾 64 KB，防止无限输出进入界面。

## 后续兼容扩展

- Windows 的本机 OpenSSH 配置模式；需交互式终端的第三方代理工具登录。
- 用户可配置的额外资源域名、跨域 SSO 和服务端 HTTP Basic 认证。
- 非 Linux 的服务发现与后台进程管理适配。
- 更完整的工作区恢复、导出导入、托管日志轮转。
- 签名、公证、自动更新与更多真实应用验证。
