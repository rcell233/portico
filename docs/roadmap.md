# 路线图

## 已实现 · 0.2

- [x] Electron + React + TypeScript、主进程热重载、构建与 CI
- [x] Portico SVG 图标及平台图标导出
- [x] Mac 启动最大化普通窗口
- [x] 加密持久化主机与应用配置
- [x] SSH agent、私钥、密码、已保存跳板机
- [x] 主机密钥确认与变化拒绝
- [x] 多主机、连接复用、保活与断线重连
- [x] 应用命名、搜索、编辑与删除
- [x] 独立网页标签页、会话隔离、HTTP / HTTPS / WebSocket
- [x] Linux 监听端口发现并保存为应用
- [x] 启动命令、工作目录、环境、就绪检查和启动等待
- [x] 重复启动合并、远端启动锁、日志与安全停止
- [x] 关闭页面后远端进程继续运行
- [x] 本机 SSH 集成测试与 Linux 生命周期测试

## 下一阶段

- [ ] 使用用户实际服务器验证 TensorBoard / JupyterLab 环境
- [x] SSH Config 优先添加、Include 枚举、搜索与重复主机提示
- [x] 系统 OpenSSH 按别名连接、ProxyCommand / ProxyJump、原生认证提示与 known_hosts
- [ ] Windows 本机 OpenSSH 模式与需交互终端的代理登录
- [ ] 可配置的跨域资源、SSO 与 HTTP Basic 网页认证
- [ ] 工作区会话恢复、批量导入导出与服务日志轮转
- [ ] macOS 签名、公证与自动更新
- [ ] Windows / Linux 桌面安装包及安全存储实测
- [ ] 确定开源许可证
