# Portico

**Your remote apps, one doorway.**

Portico 是一个基于 Electron 的远程 Web 应用工作台。目标是通过 SSH 连接多台服务器，将 TensorBoard、JupyterLab 等服务保存为应用，在桌面内直接访问，并按需启动远程服务。

## 当前状态

项目初始化阶段。已实现可运行的桌面欢迎页、路线图导航、隔离的 preload 桥接、TypeScript 检查、开发热更新、生产构建和 CI。

**SSH 连接、配置持久化、端口发现、远程网页及服务启动尚未实现。** 当前界面不包含假连接或模拟在线服务。

## 本地开发

需要 Node.js 24（参见 `.nvmrc`）和 npm。

```sh
npm ci
npm run dev
```

| 命令             | 用途                         |
| ---------------- | ---------------------------- |
| `npm run dev`    | 启动 Electron 开发模式       |
| `npm run check`  | 格式、类型和生产构建检查     |
| `npm run start`  | 运行已构建的桌面应用         |
| `npm run pack`   | 生成当前平台未打包的应用目录 |
| `npm run dist`   | 生成当前平台安装包           |
| `npm run format` | 格式化源码和文档             |

打包配置已提供；跨平台安装包、签名、公证和自动更新尚未验证或配置。首次构建使用 Electron 默认图标。

## 项目结构

```text
src/main/       Electron 主进程，未来负责 SSH、服务生命周期与存储
src/preload/    最小权限的桌面 API 桥接
src/renderer/   React 工作空间界面
src/shared/     进程间共享类型
docs/           架构与功能路线图
```

参见 [架构设计](docs/architecture.md) 和 [路线图](docs/roadmap.md)。

## 仓库与许可

初始仓库为私有仓库，尚未选择开源许可证（`UNLICENSED`）。公开发布前再决定许可证。
