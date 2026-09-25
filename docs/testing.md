# 验证

## 自动化

`npm test` 使用临时目录和仅监听 loopback 的 ssh2 测试服务器，不连接用户服务器。覆盖：

- 配置加密、并发写入、认证切换和循环跳板检测。
- SSH Config Include、循环引用、IdentityFile 选择、单主机解析失败隔离及真实 `ssh -G` 解析。
- ss / netstat / IPv6 端口解析。
- SSH 连接复用、跳板、主机密钥变化拒绝与主动断开。
- SSH 隧道中的 HTTP、WebSocket Upgrade 和 Chromium CONNECT 通道。
- 代理未认证拒绝、非目标地址拒绝、代理凭据不转发。
- 命令参数 shell 转义。
- Linux 上真实服务的去重启动、断开保活、日志与托管停止。Mac 会明确跳过这一项，Linux CI 执行。

## 桌面手动验证

运行 `npx tsx tests/manual-fixture.ts`，终端打印临时 SSH 和 HTTP 端口。测试用户为 fixture，密码仅用于此临时 loopback 服务。按 Ctrl+C 结束服务器。

1. 添加本机验证主机与应用，核对临时主机指纹。
2. 打开网页，页面应显示 SSH 加载成功、Cookie 可用、桌面 API 隔离以及 WebSocket 通信成功。
3. 重启应用后，主机和应用配置应恢复；重新打开无需再次信任未变化的密钥。
4. 验证标签页切换、编辑弹窗覆盖网页、关闭标签页与主机断开。
5. 验证最大化仍有普通窗口标题栏；图标源文件为 `resources/icon.svg`。

完成后删除临时应用和主机。此测试不代表实际 TensorBoard / JupyterLab 或全部平台兼容性已经验证。
