# dsh-ergonomics

DSH 会话人体工学 —— 一组提升 **DSH（DeepSeek Harness）** 日常会话体验的小改进。

> Ergonomics（人体工学）：让工具更顺手、更符合直觉的体验优化集合。后续可继续加入更多 UX 改进。

## 功能

### 1. `/new` 一键新会话

- 在输入框输入 `/new` 并发送，立即新建并切换到一个空白会话。
- 不用再移动鼠标去点侧栏的"新建会话"。

### 2. 输入框历史回溯（`↑` / `↓`）

- 按 `↑` 回退到上一次提交过的内容；按 `↓` 向前移动。
- 回到最新位置时，恢复你"正在输入但还没提交"的草稿；没有草稿则显示空白。
- **多行文本**：当输入框里有多行内容时，`↑`/`↓` 先负责在文本行间移动光标——只有光标位于**首行**（按**视觉行**计，含自动折行）时 `↑` 才切换历史，只有光标位于**末行**时 `↓` 才切换历史；单行内容时行为不变。
- **按会话隔离**：每个会话独立维护历史。
- **刷新不丢**：历史从会话轨迹重建，页面刷新后依然可用。

### 3. `Esc` 中断当前生成

- 焦点在输入框、且当前会话**正在生成**时，按 `Esc` 立即中断（停止）本次生成 —— 对应 CLI 里的 `Ctrl+C`。
- 没有生成运行时，`Esc` 不被拦截，保持浏览器/界面原有行为。

### 4. `Ctrl+U` 清空光标前内容

- 焦点在输入框时，按 `Ctrl+U` 删除**光标之前的所有文本**（终端里 readline 的 unix-line-discard 习惯）。
- 多行输入框同样适用：一次清掉光标前的全部内容（不限于当前行），适合推翻半截 prompt 重写。
- 不拦截 `Cmd+U`（macOS 上留给浏览器的"查看源代码"）。

## 安装

### 1. 安装到 web profile

```bash
dsh plugin --profile web add dsh-ergonomics
```

> 该命令把包装进 profile 的依赖（转发给 pnpm）。若 pnpm 配了镜像源，刚发布的包可能需几分钟同步；必要时加 `--registry https://registry.npmjs.org/`。

### 2. 在 patch 层注册

编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`（默认 `~/.dsh/profiles/web/cordis.patch.yml`），把内容写成：

```yaml
- insert:
    - id: dsh-ergonomics
      name: dsh-ergonomics
```

### 3. 重启

```bash
dsh web
```

插件集合的变更在进程重启后生效。

## 卸载

```bash
dsh plugin --profile web remove dsh-ergonomics
```

再删掉 `cordis.patch.yml` 里对应的 `insert` 段，重启 `dsh web` 即完全移除。

## 目录结构

```
dsh-ergonomics/
├── package.json
├── README.md
├── LICENSE
└── lib/
    ├── index.js    # Host 半区：注册 /new 命令（ESM 插件对象）
    └── client.js   # Client 半区：↑↓ 历史 + /new 跳转 + Ctrl+U 清空 + Esc 中断生成（web 模块加载器 bundle）
```

## 工作原理

- **Host（`lib/index.js`）**：注册 `/new` 命令，命令本身只返回 `success` 结果。
- **Client（`lib/client.js`）**：
  - 监听输入框的 `↑`/`↓`，按会话维护历史（最多 50 条）。
  - 在 `/new` 命令卡片渲染时调用 `workspaces.startSession()`，完成真正的新建并切换会话。
  - 在输入框聚焦、且会话正在生成时监听 `Esc`，通过 `sessions.binding(sessionId).session.cancel()` 中断当前生成。
  - 在输入框聚焦时监听 `Ctrl+U`，删除光标前的全部文本并把光标移到开头。

### 包的加载约定

DSH 运行时会扫描组合里的包，读取 `package.json` 的 `dsh.client` 声明与 `exports["./client"]`，把该文件当作 `window.__ModuleLoader__.load({...})` 模块加载：

- `dsh.client.platform: "web"` 标记这是一个 web 客户端半区。
- `dsh.client.inject` 声明它依赖的其他客户端包（本插件依赖 `@deepseek-ai/dsh-client-runtime`，其提供 `slots`、`workspaces` 与 `sessions` 服务）。
- `lib/client.js` 的工厂函数返回 `{ inject, apply }` 插件对象，`require("react")` 取得 React。

## 作为动态插件使用（可选）

不安装包、临时运行时，也可把 `lib/index.js` 的 `apply`/`inject`/`name` 与 `lib/client.js` 的 `apply`/`inject` 分别作为 DSH 动态插件的 Host/Client 代码加载。注意动态环境下 `React` 是环境注入的符号（无需 `require`），CSS 用运行时的 `styles.insert(...)` 注入。

## 许可证

[MIT](./LICENSE)
