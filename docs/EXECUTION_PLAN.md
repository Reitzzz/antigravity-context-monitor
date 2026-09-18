# Antigravity 2.x Standalone Context Window 详细执行计划

日期：2026-09-12。目标平台：用户本机 Windows / Antigravity Standalone 2.13.0。

## 1. 目标与验收原则

交付一个能在真实 Standalone GUI 当前会话显示上下文的轻量插件。数值有明确来源、分母来自同一请求，错误/未知不冒充正常。保留启动便捷性、独立窗口绑定、可重复注入和可撤销性。

「全部 Antigravity 2.x / 全部模型兼容」需逐版本、逐模型验收，不能由单次 2.13.0 测试推定。第一版验收对象是原生请求开始快照，不是逐 token 计数，也不是账号配额。

## 2. 引用对话的证据复核

| 引用对话中的主张 | 本次证据 | 决策 |
| --- | --- | --- |
| LOUIS GUI 壳可能适用 | 本机 appVersion 2.13.0、local HTTPS `/c/<id>`、APP_CONFIG、模型按钮挂载点均存在 | 保留 CDP 路径，重写错误处理与目标校验 |
| 一律固定 1M | 原代码属实；本机原生 maxContextTokens=256000 | 删除固定分母 |
| 应统一去掉 cacheRead，只用 checkpoint input+output | 当前 239 步没有 CHECKPOINT，usage 在 PLANNER_RESPONSE；分离 input/cache 的实际数字与对话假设不符 | 不盲目移植 IDE 算法，也不据此断言所有 provider 的 usage 公式 |
| AGI 的 checkpoint Core 可直接搬 | AGI README 明确是 IDE 插件；本机数据结构不同 | 使用本机原生 contextWindowMetadata，避免估算/缓存语义混淆 |
| 只读取前 500 步会漏数据 | 原代码请求 startIndex=0/endIndex=500 | 不使用该 steps 路径；直接获取生成器元数据，并按有效 stepIndices 排序与裁剪 |
| 其他成熟 GUI 驱动值得参考 | Telegram suite 文档提供 Standalone 参考；本机已经有可用 CDP 接口 | 不引入遥控、自动接受、消息发送等无关模块 |

真机关键样本（仅保留数字，不保留对话正文/身份字段）：

```text
stepCount = 239
latest associated step index = 238
native estimatedTokensUsed = 145624
native maxContextTokens = 256000
native percentage = 56.884375%
planner usage: input=5778, cacheRead=138096, output=347
```

由此可以确认原生快照存在，不能把上述 usage 中某个字段或简单加和直接当作同一口径的上下文估算。原生字段名明确是 estimated，UI 必须保留约数。

## 3. 最小架构

```text
DevToolsActivePort → 本机 CDP page 列表
  → 校验 loopback + APP_CONFIG.productName/appVersion
  → 当前页面注入 Shadow DOM 挂件
  → 当前 /c/id → summary.stepCount
  → generatorMetadata → native contextWindowMetadata
  → 纯函数验证/选择快照 → UI（约数、来源、时点、未知状态）
```

仅使用现有 Node 22+ 的 fetch/WebSocket 和标准库。移除未使用 ws 依赖，不加入 VSIX、Electron 外壳或构建工具。认证只存在当前渲染页面内存中，不持久化、不写入日志。

## 4. 分阶段执行及验收门槛

### P0：真机协议调查（已完成）

1. 阅读引用对话、本地所有源码和启动器。
2. 检查运行 exe 的版本、DevToolsActivePort、CDP 页面及 APP_CONFIG；不输出 token。
3. 检查已打开对话的 steps 类型与 generator metadata；仅输出字段形状和必要数字。
4. 确定原生估算/上限来自同一请求，确认模型标签映射。

交付：上述证据表。门槛：必须有真实请求响应，不能仅凭 README 或历史聊天判断兼容。

### P1：上下文数据核心（已完成）

1. 将原生解析做成纯函数并注入同一份函数，防止测试代码与浏览器实现漂移。
2. 按 stepIndices 选择当前有效最新请求，支持字符串形式 protobuf 数字。
3. 非法/缺失数值、零分母均返回未知；合法零值和超 100% 保留真实含义。
4. 返回快照模型、关联步骤、之后的步数、顶层 token 分解和 checkpoint 推进信息。
5. 禁止静默退回旧快照、固定模型表或累计用量。

交付：context_core.mjs + 无依赖回归测试。门槛：239 步真机样本读数一致；长会话、回退、未知数值合成用例通过。

### P2：GUI 及状态管理（已完成，见验证记录）

1. 仅绑定当前 `/c/<id>`，不以最近活跃对话替代当前窗口。
2. 选择器标签去除括号等格式差异；模型切换后等待相应新快照。
3. 请求串行、有超时、有 AbortController；切换时清空旧值，拒绝旧请求回写。
4. UI 使用 Shadow DOM 隔离样式，支持 hover/click/focus/Escape。
5. 清晰展示约数、统计时点、来源；错误/无会话/空会话显示未知说明。
6. 活跃 3 秒、空闲 15 秒轮询，失败退避；定时检查路由和挂载点，不修改 history API。

门槛：真机挂载和弹层可见、单例、来源值对齐、键盘关闭有效。会话/模型变化与网络错误补充自动化边界验证。

### P3：运行与安装（已完成基础实现）

1. CDP 仅连接 loopback；页面必须通过 Antigravity 2.x 身份检查。
2. 删除作者机器路径、固定代理和任意监听端口猜测。
3. 提供 check/once/remove 模式和 profile/port 显式覆盖。
4. 持续服务重新发现窗口，在 CDP 消失约 30 秒后退出；Ctrl+C 清理挂件。
5. Windows 静默联动启动器复用 Node，不增加开机启动项。

门槛：当前真机诊断通过；重复注入/卸载/再注入通过。跨重启和非默认安装路径需在对应环境验收。

### P4：审查与交付（本次收尾）

1. 执行 npm test 与可重复运行的 test:live。
2. 检查挂件截图、越界、无效状态；只保存挂件裁剪，不保存聊天截图。
3. 独立检查异步竞争、安全边界、生命周期和误导读数风险。
4. 删除临时上游源码，检查凭据/作者硬编码路径/临时文件。
5. 更新 README 与真实验证矩阵。

当前目录来自源码压缩包，没有 .git；无法提供 git diff/status。此次不擅自初始化 Git、不推送、不发布。

### P5：后续扩大兼容范围（未宣称完成）

按以下顺序逐项验收，每项通过后才扩展支持声明：

1. 其他模型：使用已有 Gemini Pro、Claude、GPT-OSS 会话，核对原生 metadata 与挂件；有原生数据就读取，无数据就未知，禁止推测分母。
2. 真实超 500 步会话：已对齐关联第 1,150 步的快照；响应体大小与长期轮询成本仍待测量。
3. 回退/重做/同长度分支替换：使用专门测试会话，不在用户工作会话中主动执行回退。
4. 压缩：等待专门测试会话自然触发，核对 checkpointIndex、请求边界及窗口值；只在有证据时升级提示用语。
5. 多窗口、刷新、客户端退出再启动、睡眠恢复：验证每窗口绑定、挂件重建、断线恢复和守护退出。
6. 较早/较新 2.x 小版本：建立版本矩阵，核验字段与挂载点；若协议改变，新增有真实样本支撑的兼容分支。
7. 若全量元数据在真实长会话过大，再调查增量/缓存协议。优化必须能检测回退、同长度重写与迟到元数据，不能只按步数缓存。

## 5. 不纳入首版

账号配额、额度账单、遥控、自动发送消息、自动接受操作、IDE/CLI 兼容、未知 provider 的 usage 估算、逐 token tokenizer。它们既不是当前原生 Context Window 的必要依赖，也缺乏本机验证需求。

## 6. 来源

- [LOUIS 原始项目](https://github.com/LOUIS798000/antigravity-context-monitor)
- [AGI IDE 项目](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor)，本次直接读取 main SHA `31a5137a8caebae418fcc270e1fc9972244ec28e`，用于比较架构/算法，不复制源码。
- [AGI tracker 源码](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/blob/31a5137a8caebae418fcc270e1fc9972244ec28e/src/tracker.ts)
- [Standalone 驱动参考](https://github.com/emreturkmencom/antigravity-telegram-suite)
- 决定首版数据路径的主要证据：本机 2.13.0 只读 RPC 响应与客户端版本，不以历史对话作为事实来源。
