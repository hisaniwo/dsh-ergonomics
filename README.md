# dsh-ergonomics

DSH 会话人体工学 —— 一组提升 **DSH（DeepSeek Harness）** 日常会话体验的小改进。

> Ergonomics（人体工学）：让工具更顺手、更符合直觉的体验优化集合。后续可继续往里加入更多 UX 改进。

## 功能

### 1. `/new` 一键新会话

- 在输入框输入 `/new` 并发送，立即新建并切换到一个空白会话。
- 不用再移动鼠标去点侧栏的"新建会话"。

### 2. 输入框历史回溯（`↑` / `↓`）

- 按 `↑` 回退到上一次提交过的内容；按 `↓` 向前移动。
- 回到最新位置时，恢复你"正在输入但还没提交"的草稿；没有草稿则显示空白。
- **按会话隔离**：每个会话独立维护历史。
- **刷新不丢**：历史从会话轨迹重建，页面刷新后依然可用。

## 目录结构

```
dsh-ergonomics/
├── package.json
├── README.md
├── LICENSE
└── src/
    ├── index.js    # Host 半区：注册 /new 命令
    └── client.js   # Client 半区：↑↓ 历史 + /new 跳转
```

## 工作原理

- **Host（`src/index.js`）**：注册 `/new` 命令，命令本身只返回 `success` 结果。
- **Client（`src/client.js`）**：
  - 监听输入框的 `↑`/`↓`，按会话维护历史（最多 50 条）。
  - 在 `/new` 命令卡片渲染时调用 `workspaces.startSession()`，完成真正的新建并切换会话。

## 使用方式

### 方式一：作为动态 Cordis 插件加载（当前已验证的路径）

这是本项目代码当前最直接的运行方式。通过 DSH 的动态插件能力，把 Host 半区与 Client 半区分别作为插件代码加载：

- **Host 代码**：`src/index.js` 中 `name`/`inject`/`apply` 的内容，包装成 `return { name, inject, apply }`。
- **Client 代码**：`src/client.js` 中 `inject`/`apply` 的内容，包装成 `return { inject, apply }`（`React` 与 `styles` 由 DSH 客户端运行时注入）。

> 两个半区同属一个插件实例：Host 负责注册命令，Client 负责输入历史与新会话跳转。

### 方式二：作为 npm 包安装（Roadmap）

DSH 通过 `cordis.yml` 组合加载插件。将本包发布为 npm 包后，可像其他 `@deepseek-ai/dsh-*` 插件一样被组合引用。当前 `package.json` 已按 DSH 插件的 Host/Client 拆分约定声明了 `exports`（`"."` 指向 Host，`"./client"` 指向 Client），并声明了所需的 `peerDependencies`。客户端半区的模块加载器打包属于后续工作。

## 许可证

[MIT](./LICENSE)
