# 验证记录

日期：2026-09-13（覆盖 2026-09-12 记录）。Windows / Antigravity Standalone 2.13.0（Electron 41.10.3 / Chrome 146.0.7680.216）/ Node 24.14.1。挂件版本 `2.0.5-native-context`。

## 弹层样式改版（2.0.5）

按用户提供的 ZCode 上下文面板参考重做弹层：标题行「上下文容量 + ~万级分子/分母 (百分比)」、蓝色渐变进度条、圆点色阶的分组占比列表（各分组 tokens / 已用上下文，合计 100%）。诚实性要素保留在次要文字行：`~` 约数标记、快照模型、原生估算来源与统计时点、读取时间/关联步骤/剩余。未知态标题右侧显示 `—`，原因文字占主说明行。真机 `test:live` 复跑 PASS，`docs/live-widget.png` 已重截目检：分组占比 10% + 12.5% + 77.5% 与原生 breakdown（12,143 / 15,121 / 94,096，合计 121,360）一致。

## P4 收尾：统一批次与对抗审查

- `npm test` 单次批次 16/16 通过（核心 10 + 界面状态 6，含模型归属校验两条回归用例）。此前分批记录作废，以本批次为准。
- 两阶段独立审查（盲审建模 → 逐条反驳）结论：
  - **确诊并修复（C1）**：`GetUserStatus` 拉取失败当口 `configs` 被清空，模型切换判定短路失效，旧模型快照会被直接接受且显示内部占位 ID。修复：失败时保留上次成功配置；配置从未加载成功时渲染未知而非 ready。补回归测试。
  - **追加补齐（C1 延伸，用户评审指出）**：非空但过期的配置列表同样不能证明归属——选择模型与快照模型都映射不到时，旧判定两个比较条件均跳过、仍显示 ready。修复为**正向归属**：仅当「当前选择映射到的模型 ID 等于快照模型」或「快照模型映射到的标签等于当前选择」时才渲染读数；确认不一致显示等待新模型；映射缺失显示「无法校验」未知并强制刷新配置缓存（`configsAt` 置 0）。挂件版本 `2.0.4-native-context`，补第二条回归用例，真机 `test:live` 复验 PASS（1150 步样本 121,360/256,000 与记录一致）。
  - **确诊并修复（C5）**：`test:live` 独立比较块在最新元数据缺 `contextWindowMetadata` 时（真实瞬态形态）以未捕获 TypeError 异常退出。修复：可选链解引用 + 明确断言消息，保证可重复运行且失败可诊断。
  - **推翻（C2）**：`AbortSignal.any` 兼容性担忧。直接证据：页面 UA Chrome/146，`typeof AbortSignal.any === 'function'`，修复后构建 live 全绿。
  - **推翻（C4）**：routeTimer 以可见选择器数量判变更的「抖动反复清读数」担忧。挂载锚定输入区行、250ms 采样限界、过渡态自愈。
  - **降级观察（C3）**：idle 判据依赖 `CASCADE_RUN_STATUS_RUNNING` 字面量。真机确认 `CASCADE_RUN_STATUS_IDLE` 存在且判否方向正确；`RUNNING` 字面量本身未能在观察窗口内取到活跃样本。影响仅轮询时效，非误导读数。待活跃会话顺带核验。

## 真机集成（修复后连续两次）

- `npm run check`：supported、2.13.0、anchor 存在。
- `npm run test:live` ×2 均 PASS（singleton/dispose/reinstall/native values/same-row alignment/popover bounds/Escape）；1150 步样本读数 121,360 / 256,000 @ 关联第 1150 步（约 47.4%），与 2026-09-12 记录一致。
- `docs/live-widget.png` 已重截并目检：仅挂件裁剪、弹层无越界、无聊天正文。

## P5 本机实测

- **多模型数据层**：只读枚举本机全部 77 条有步数会话（7 个模型），同一份注入解析器全部 ready、零错误。分母随模型不同：Claude Opus 4.6 → 160,000；Gemini 3.1 Pro → 128,000；Gemini 3.x Flash 系 → 256,000。确认「有原生数据就读、不猜分母」在各模型成立。
- **非 Flash 挂件级挂载**：本机现存非 Flash 会话（Opus、3.7 Flash 等）均无输入区/模型选择器（归档或无项目上下文），挂件按设计拒挂并显示未知——「无挂载点暂停」路径真机成立；带 composer 的非 Flash 会话挂载核对仍待有此类会话时补做。
- **窗口关闭→托盘**：CDP 返回空目标列表，守护持续等待不误退（设计行为真机复证）。
- **重发现/再注入**：窗口重开与页面导航后守护约 5 秒内重注入单例挂件（多次观察）。
- **断线退出**：完全退出客户端后守护约 30 秒以退出码 0 结束。
- **重启重连**：重启客户端后 `npm start` 正常重连挂载；`npm run remove` 干净移除（installed:false, mounted:false）。
- **SPA 会话切换**：侧边栏切换会话即清空重读，57,225 步外会话 132,655/256,000（51.8%）与枚举值一致。
- **多窗口**：2.13.0 菜单未暴露第二窗口入口（File/Window 菜单仅有 New Conversation），每窗口独立绑定仍待有真实多窗口环境时验收。
- **GPT-OSS**：本机无该模型历史会话，未验收。

## 限制

本节记录 2026-09-13 的范围。模型数据层、GPT-OSS、响应体体积，以及「不维护 2.x 小版本矩阵」这一决定，以文末 2026-09-25 的测量为准。

- 仅 2.13.0 已真机核验；其他 2.x 小版本未验收。
- 真实回退、压缩触发、睡眠恢复、非默认安装路径仍待专门环境验证。
- 原生数值为最近请求开始时的估算，非逐 token 精确实时统计。
- 原生接口属于客户端内部接口，升级可能变化；结构不匹配时降级为未知。
- 当前目录无 .git，改动以备份 diff 记录交付；未初始化或推送仓库。

## 2.0.6 修复批次（2026-09-18）

按审查结论与计划修正确性/归属/守护健壮性，挂件版本 `2.0.6-native-context`。

- 配置缺 `label` 不再抛 TypeError；按模型 ID 查找只使用带字符串 label 的条目。
- `ready` 一律要求正向归属：快照无模型、选择器无文本、别名/自动路由均显示未知，不再把选择器文本冒充「快照模型」。
- 去掉 `chatModel.model` 回退；`checkpointIndex` 接受有符号数字字符串；同一步多条元数据一致才采用，不一致则未知（`tiedRequests` 供 live 观察）。
- `poll()` 以 try/finally 释放 `busy` 并安排下次定时；注入异常带出 `exceptionDetails`；CDP fetch 失败附带 `cause.code`。
- 配置刷新改为 `configsDue`（成功 60s，映射缺失 15s 后再拉）；焦点打开仅限 `:focus-visible`；先探测再注入；Ctrl+C 通过 AbortSignal 打断等待。
- 版本从 `widget_client.js` 单源读取（改挂件源码后需重启守护）；启动器解析 `node.exe` 绝对路径。

`npm test`：35/35 通过（原 16 + 本批次 19）。`npm run test:live` PASS：1340 步样本 224,885 / 256,000，`tiedRequests: 1`（本会话无同一步并列），`disagree: false`，几何与 Escape 仍成立。本窗口未观察到 `CASCADE_RUN_STATUS_RUNNING`。

## P5 收尾测量（2026-09-25）

环境：本机正在运行的 Standalone 2.17.0。`npm test` 46/46 通过。`npm run measure` 只读扫描 47 条有步数会话，`errors: 0`，`conversationPages: 1`。输出不含会话标识或正文。

- 数据层全部 `ready`。分母：Gemini 3.8 Flash (High) 38 条与 Gemini 3.7 Flash (High) 1 条为 256,000；Gemini 3.1 Pro (High) 1 条为 128,000；Claude Opus 4.6 (Thinking) 1 条为 160,000；GPT-OSS 120B (Medium) 1 条为 80,000。`MODEL_PLACEHOLDER_M301` 4 条、`MODEL_PLACEHOLDER_M322` 1 条没有配置标签，分母 256,000。
- 挂件：Gemini 3.1 Pro (High) `test:live` PASS，24,641 / 128,000。随后打开的 Claude Opus 4.6 (Thinking) `test:live` PASS，24,419 / 160,000，关联步骤索引 1，`tiedRequests: 1`，`disagree: false`。分母与该模型数据层的 160,000 一致。再随后打开的 GPT-OSS 120B (Medium) `test:live` PASS，24,366 / 80,000，关联步骤索引 1，`tiedRequests: 1`，`disagree: false`。分母与该模型数据层的 80,000 一致。三次都通过单例、卸载、同行对齐、弹层边界和 Escape。当时各只有 1 个 `/c/` 页面，选择器文本分别为对应模型标签。
- 体积：最长 537 步、263 条元数据、解码后 785,067 字节。全部会话 `maxParsePlusReadMs` 15.6。空闲 15 秒轮询下最大约 3,140,268 字节/分钟。门槛 2 MB / 100 ms 都未达到，`item7: not-triggered`，未加缓存。
- checkpoint：`checkpointAdvancedSessions: 0`。537 步样本的最新与上一条 checkpoint 都是 1。提示语未改。
- 回退与同长度替换：`tests/widget.test.mjs` 有两条回归。真机：GPT-OSS 专用会话点「撤销到此节点」后，步数 5 → 2，第二轮离开页面，原句回到输入框。生成器元数据只剩第 1 步，原生窗口仍是 24,366 / 80,000，checkpoint 仍是 -1；`plannerConfig` 被去掉，模型 ID `MODEL_OPENAI_GPT_OSS_120B_MEDIUM` 只在 `chatModel.model`。挂件状态 `unavailable`，文案「快照未标注模型，无法确认归属；不显示读数」，没有「检测到回退」。随后发送「test」，步数回到 5，状态 `CASCADE_RUN_STATUS_IDLE`。第 1 步仍无 `plannerConfig`；新的第 4 步有 `planModel`，24,710 / 80,000，checkpoint -1。挂件 `ready`，快照 24,710 / 80,000，关联步骤显示 5，弹层 ~2.5万/8万（30.9%），剩余约 55,290。说明里没有「检测到回退」。同长度替换未做。
- 多窗口：只有 1 个 `/c/` 页面。刷新：撤销后的 GPT-OSS 会话重载窗口后，挂件单例恢复，与模型选择器同一行。18:36:48 `Antigravity.exe` 与 `watch_context_widget.mjs` 同时启动，用户随后确认完全退出再打开和睡眠唤醒后圆环都还在；进程启动时间未变，说明唤醒后没有另起一套进程。核对时 Standalone 2.17.0，挂件 `2.0.6-native-context`，`ready`，24,710 / 80,000，关联步骤索引 4，与原生 `planModel` `MODEL_OPENAI_GPT_OSS_120B_MEDIUM` 一致，单例，28×28，中心差 0。睡眠时长未计时。
