# 架构方向

## 当前工程

Electron + React + TypeScript，使用 electron-vite 构建，npm 锁定依赖。

- 主进程管理窗口，启用 sandbox 和 contextIsolation，禁用 Node integration。
- preload 仅暴露只读 platform 信息，不暴露通用 IPC 或命令执行接口。
- renderer 仅呈现本地界面，阻止窗口导航与新窗口，默认拒绝权限请求。

## 下一阶段的职责划分

- 主机：SSH 地址、端口、用户、认证引用、主机密钥、跳板机。
- 应用：稳定 ID、名称、主机 ID、远程地址与端口、路径、独立浏览会话。
- 启动配置：工作目录、环境、启动命令、就绪检查、日志位置和生命周期策略。
- 连接：同主机连接复用、引用计数、超时与重连。
- 页面：独立 WebContentsView，不与工作空间共享 preload；登录状态按应用隔离。

服务打开流程：连接主机 → 检查服务身份与健康状态 → 必要时启动 → 等待就绪 → 打开网页。关闭页面默认不停止远程服务。不能仅凭端口被占用就认定目标服务已运行。

## 待验证的设计

1. SSH 库与系统 OpenSSH 的兼容取舍，包括 agent、ProxyJump 和 SSH config。
2. localhost 随机端口转发与应用专用代理：只监听 loopback 不代表只能被本应用访问。
3. HTTP、HTTPS、WebSocket、重定向、Cookie 和下载的兼容性。
4. 服务发现先支持 Linux 的 ss / netstat，展示权限限制与识别不确定性。
5. 后台服务管理选择 tmux 或用户级 systemd 等机制，处理断开、重复启动与日志。
6. 凭据存入操作系统安全存储，不提交或明文持久化私钥、密码、令牌。

## 参考

- https://electron-vite.org/guide/
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/api/web-contents-view
