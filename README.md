# Portico

<img src="resources/icon.svg" width="88" alt="Portico" />

**Your remote apps, one doorway.**

Portico 是一个基于 Electron 的远程 Web 应用工作台。通过 SSH 连接多台服务器，将 TensorBoard、JupyterLab 等服务保存为应用，在独立桌面标签页内直接使用。

## 已实现

- 主机与应用的新增、编辑、删除、搜索和加密持久化。
- 本机 SSH Config 主机直接由系统 OpenSSH 连接：ProxyCommand、ProxyJump、IdentityAgent、证书和多密钥按原配置处理。手动主机保留 agent、私钥、密码和已保存跳板机。
- 本机配置连接沿用 OpenSSH 的 known_hosts 与认证规则；认证提示在应用内完成。手动主机单独保存指纹。支持连接复用和断线重连。
- 添加应用先选主机再选端口，主机优先读取 `~/.ssh/config`；支持 Include、搜索与手动配置。左侧按主机默认展示已保存应用。
- Linux 监听端口发现（`ss` / `netstat`），选择服务保存为应用。
- 独立 WebContentsView 标签页，HTTP / HTTPS / WebSocket 通过 SSH 访问。
- 每个应用独立的持久化 Cookie / 登录会话，浏览器前进、后退、刷新和文件下载。
- 按需启动命令、工作目录、环境变量、健康检查、启动超时、日志查看和安全停止托管进程。
- TensorBoard、JupyterLab、Streamlit 配置模板。
- SVG 图标及其 PNG / ICNS / ICO 导出，Mac 启动默认最大化普通窗口，不进入系统全屏。

## 开发与运行

需要 Node.js 24（`.nvmrc`）和 npm。

```sh
npm ci
npm run dev
```

| 命令             | 用途                                                            |
| ---------------- | --------------------------------------------------------------- |
| `npm run dev`    | 桌面开发，主进程和界面自动重载                                  |
| `npm run check`  | 格式检查、集成测试、类型检查和生产构建                          |
| `npm test`       | 使用临时本机 SSH 服务器测试；Linux 还会验证真实后台进程生命周期 |
| `npm run start`  | 构建并运行生产界面                                              |
| `npm run icons`  | 从 SVG 重新生成平台图标                                         |
| `npm run pack`   | 当前平台的未打包应用目录                                        |
| `npm run dist`   | 当前平台安装包                                                  |
| `npm run format` | 格式化源码和文档                                                |

## 第一次使用

1. 点击“添加应用”，从已保存主机或本机 SSH Config 选择 Host；列表中没有时选择“手动配置”。从主机旁的“＋”创建会直接进入端口选择。
2. 核对首次连接提示中的主机指纹。跳板机本身也需要独立核对。
3. 选择发现的服务端口或手动输入端口。地址默认 `127.0.0.1`；协议与路径在“连接设置”中。名称可留空，首次成功加载时保存网页标题；无标题时显示端口，后续导航不会覆盖名称。
4. 如果需要，启用按需启动，填写命令、工作目录和环境。默认只连接已有服务。
5. 点击“打开应用”会保存并进入页面；侧栏自动收起，通过“返回工作空间”回到主机和应用列表。关闭标签页或退出 Portico 后，远端托管服务继续运行。

示例：工作目录 `/home/me/project`，启动命令：

```sh
exec /home/me/venv/bin/tensorboard --logdir ./runs --host 127.0.0.1 --port 6006
```

Jupyter 保持原有身份验证。可以在日志中查看 token，通过 Jupyter 登录页面输入，或填入应用路径 `/lab?token=…`。路径和环境变量也包含在加密配置中。

## 运行边界

- 托管启动/停止要求远端 **Linux + Python 3 + Bash**；发现端口要求 `ss` 或 `netstat`。纯网页访问只要求 SSH 服务器允许 TCP 转发。
- 启动命令应在前台运行，推荐 `exec ...`，不要加 `&` 或自行 daemonize。Portico 使用独立进程会话和远端日志文件保活。
- 只会停止经过 PID、进程出生时间和应用标记校验的托管进程组。外部启动的服务不被停止。
- 应用代理只允许已配置的服务地址/端口；跨域 SSO、外部 CDN、跳转到其他端口暂不支持。
- HTTPS 正常验证证书，不绕过自签名证书错误。本机 SSH Config 的认证由系统 OpenSSH 处理，密码、私钥口令与 keyboard-interactive 提示通过 SSH_ASKPASS 接入界面，不保存响应。
- SSH Config 中的 Host 只保存别名引用，`ssh -G` 仅用于列表摘要。每次重新连接读取当前原配置，支持 Include、ProxyCommand 和 ProxyJump；不转换为 Portico 的手动认证配置。
- 本机配置模式当前支持 macOS / Linux OpenSSH；Portico 管理自己的连接复用套接字，禁用配置中的额外端口转发、远程登录命令和 TTY 分配，以建立应用通道。需要交互式终端的第三方代理登录工具仍应先在终端完成登录。
- 自动发现的是 TCP 监听端口，不保证每个端口都是 Web 应用。其他用户或容器网络内的进程可能不可见。
- 自动启动只在端口未连接时进行。端口上已有服务但健康检查失败时不会重复启动；可设置“预期响应文本”检查应用身份。
- macOS 使用系统钥匙串保护配置。Linux 必须有 Secret Service 等安全存储，不回退到明文。
- 当前没有安装包签名、公证或自动更新；Windows/Linux 桌面安装包仍需对应平台实测。

## 文件位置与结构

工作空间保存为 Electron userData 目录中的 `workspace.enc`（原子写入、权限 0600、系统安全存储加密）；不会保存私钥文件内容。

远端托管元数据与日志位于 `~/.local/share/portico/services/<app-id>/`。删除本地应用配置不会删除远端文件或停止服务。

```text
src/main/core/  SSH、加密存储、代理、服务发现和进程生命周期
src/main/views.ts  隔离网页、代理认证与标签页
src/preload/    固定类型的 IPC 桥接
src/renderer/   主机、应用、日志和配置界面
src/shared/     跨进程类型
resources/      SVG 源图标与平台导出
scripts/        图标生成
tests/         本机 SSH 集成测试与 Linux 生命周期测试
```

[架构设计](docs/architecture.md) · [路线图](docs/roadmap.md) · [测试说明](docs/testing.md)

私有仓库，尚未选择开源许可证（`UNLICENSED`）。
