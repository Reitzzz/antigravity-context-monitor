# Antigravity Context Monitor (上下文容量监控)

一个用于 Google Antigravity 的轻量级会话上下文容量可视化小工具。

通过 CDP 协议向本地运行的 Antigravity 客户端渲染层注入原生风格的圆环挂件，实时显示当前会话的上下文 Token 占用情况。

---

## 主要特点

- **对齐原生 UI**：完全采纳 Antigravity 原生设计系统规范（中等字重 Medium 500、原生色彩变量 `var(--card)` / `var(--foreground)`、32x32 几何圆环规范），视觉质感浑然一体。
- **极简展示**：
  - 底栏常驻微型环形指示器（置于模型选择按钮右侧）。
  - 鼠标悬停显示极简卡片：显示 **上下文容量百分比**、**微型进度条** 以及 **容量占用（如 170.7k / 1.0M）**。
- **与软件同启同退**：
  - 不添加 Windows 开机启动项（注册表零残留）。
  - 伴随 Antigravity 启动；当主程序完全关闭后，守护进程在数秒内自动销毁退出，不占用后台资源。
- **低资源开销**：
  - 拔除全部全局 DOM 监听器（MutationObserver），采用轻量定时器感知，杜绝界面卡顿。
  - 单例防重锁保障全页面唯一实例。

---

## 目录结构

```text
antigravity-context-monitor/
├── src/
│   ├── widget_client.js         # 注入到 Antigravity 渲染进程的客户端 UI 与数据拉取逻辑
│   └── watch_context_widget.mjs # 伴随监听与自动注入服务（自动管理生命周期）
├── win/
│   ├── start_context_monitor.vbs # 后台静默拉起脚本（无黑框）
│   └── antigravity-launch.bat    # Windows 一键联动启动脚本
├── package.json
├── LICENSE
└── README.md
```

---

## 使用说明

### 方式 1：通过启动脚本一键启动（推荐）

直接通过 `win/antigravity-launch.bat` 启动 Antigravity。该脚本会联动静默拉起监控服务并打开 Antigravity。

### 方式 2：手动运行守护进程

在终端中执行：

```bash
node src/watch_context_widget.mjs
```

服务将自动侦测本地 Antigravity 实例的 CDP 调试端口并注入挂件。主程序退出后守护进程自动退出。

---

## 技术细节

- **数据来源**：调用 Antigravity 本地 Language Server 接口 `GetCascadeTrajectorySteps`，提取当前会话最新步的 `modelUsage`（合并统计 `inputTokens`、`cacheReadTokens`、`outputTokens`）。
- **容量基准**：按 1,000,000 Tokens（1.0M）计算当前占用百分比。
- **指示器色彩规则**：
  - 占用 < 50%：原生白蓝系品牌主色 `#007acc`
  - 50% ≤ 占用 < 80%：琥珀预警色 `#ac830b`
  - 占用 ≥ 80%：红色警示色 `#f05151`

---

## 许可证

[MIT License](LICENSE)
