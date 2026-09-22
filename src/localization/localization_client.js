// Adapted from the user-supplied Antigravity Windows v2.1.0 translation engine.
// Original: Copyright (c) 2026. All rights reserved.
(() => {
    // 汉化翻译引擎（CDP 注入版，基于容器回溯隔离）
    // 防重复注入：若已注入过（有全局标记），先断开旧 observer 再重建，避免叠加
    if (window.__ag_hanhua_engine__) {
        try { window.__ag_hanhua_engine__.disconnect(); } catch (e) {}
        delete window.__ag_hanhua_engine__;
    }
    const map = new Map(Object.entries(DICT_PLACEHOLDER));
    const lowerMap = new Map();
    for (const [k, v] of map.entries()) lowerMap.set(k.toLowerCase(), v);
    const phrases = PHRASES_PLACEHOLDER;
    const exactPhrases = new Map(Object.entries(phrases.exact));
    const foldedPhrases = new Map(Object.entries(phrases.exactIgnoreCase));
    const periodExact = new Set(phrases.optionalPeriod.exact);
    const periodFolded = new Set(phrases.optionalPeriod.exactIgnoreCase);
    // Longer prefixes win. A short marketing sentence must not swallow a longer one.
    const prefixPhrases = Object.entries(phrases.prefixIgnoreCase).sort((a, b) => b[0].length - a[0].length);

    // 按 key 长度降序（长条目优先，避免短条目先匹配吃掉长条目的子串）
    const allEntries = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
    // 预筛：只有长度 >= 30 的完整句子参与子串替换。
    // 门槛必须高：像 "safety barriers" 这种半截短语若参与子串替换，
    // 会把整句里的碎片换成中文、剩下英文，产生"中英混杂"。短条目只做整节点精确匹配。
    const phraseEntries = allEntries.filter(e => e[0].length >= 30);
    // 记录每个文本节点上一次处理过的值：值没变就跳过，避免重复开销
    const lastSeen = new WeakMap();
    // 属性侧的同款 memo：元素 → {属性名: 上次见过的值}。
    // 没有它，每 2 秒的定时器要把全部元素的 8 个属性重新归一化、查表。
    // 文本节点用 lastSeen 跳过未变值。整句在词库里，这里只留下带变量的规则。
    const attrSeen = new WeakMap();


    // 保护名单：产品名/品牌，禁止子串替换（防止被部分匹配切碎）
    const PROTECTED = [
        'antigravity', 'jetski', 'gemini', 'google ai', 'best of n',
        'google chrome', 'marketplace', 'mcp', 'citc',
    ];
    function isProtected(s) {
        const low = s.toLowerCase();
        for (const p of PROTECTED) {
            if (low.includes(p)) return true;
        }
        return false;
    }

    // 智能子串替换：只有 phraseEntries（key 长度 >= 30 的完整句子）参与。
    function smartReplace(text) {
        let result = text;
        for (const [key, val] of phraseEntries) {
            // phraseEntries 按 key 长度降序。比文本还长的 key 不可能命中，
            // 用一次整数比较挡掉，省下昂贵的 indexOf 全串扫描。
            // 界面标签大多很短，这一条能挡掉 306 条里的绝大多数。
            if (key.length > result.length) continue;
            let idx = result.indexOf(key);
            if (idx === -1) continue;
            while (idx !== -1) {
                const before = idx > 0 ? result[idx - 1] : '';
                const afterIdx = idx + key.length;
                const after = afterIdx < result.length ? result[afterIdx] : '';
                const isWordBoundary =
                    (!/[一-鿿A-Za-z0-9]/.test(before)) &&
                    (!/[一-鿿A-Za-z0-9]/.test(after));
                if (isWordBoundary) {
                    result = result.slice(0, idx) + val + result.slice(afterIdx);
                    idx = result.indexOf(key, idx + val.length);
                } else {
                    idx = result.indexOf(key, idx + key.length);
                }
            }
        }
        return result;
    }

    // 禁区：代码/编辑器/输入/对话内容容器（防止翻译用户数据与代码）
    const BLOCKED_CLASS_SUBSTR = [
        'code-view', 'editor-container', 'monaco-editor', 'suggest-widget',
        'output-view', 'debug-console', 'artifact-container',
        'code-block', 'diff-view', 'input-area', 'chat-input',
        'font-mono', 'font-code', 'monospace', 'code-font',
        'group/file-row', 'file-tree', 'tree-item', 'file-row', 'file-item', 'file-node',
        'file-entry', 'folder-row', 'explorer-item',
        'group/run-command', 'group/user-input-step', 'run-command-step', 'user-input-step',
        'planner-response-text', 'view-file-step', 'tool-call', 'tool-result',
        'breadcrumb', 'breadcrumbs', 'breadcrumb-segment', 'path-segment',
        'cm-', 'view-lines', 'view-line'
    ];
    const BLOCKED_CLASS_TOKEN = [
        'terminal', 'xterm', 'preview', 'token', 'hljs', 'shiki', 'prism',
        'font-mono', 'font-code', 'monospace'
    ];
    const BLOCKED_TAGS = ['SCRIPT', 'STYLE', 'CODE', 'PRE', 'INPUT', 'TEXTAREA',
                          'SVG', 'CANVAS', 'SYMBOL', 'PATH', 'MATH', 'KBD'];

    const TRANSLATABLE_ATTRS = ['placeholder', 'title', 'aria-label', 'alt',
                                'data-title', 'data-tooltip-content',
                                'aria-description', 'aria-placeholder'];

    // 代码、路径、命令特征嗅探：杜绝误翻代码和文件路径（零依赖 DOM 结构）
    const FILE_EXT_RE = /(?:^|[/\\]|[ ])([a-zA-Z0-9_.-]+[.](?:py|m?js|c?js|m?ts|c?ts|tsx|jsx|json[c5]?|mdx?|markdown|html?|css|scss|sass|less|vue|svelte|astro|go|rs|c|cpp|cc|cxx|h|hpp|hxx|java|kt[s]?|scala|rb|php|sh|bash|zsh|fish|ps1|bat|cmd|vbs|sql|ya?ml|toml|ini|env|xml|svg|png|jpe?g|gif|ico|webp|pdf|zip|tar|gz|bz2|7z|dmg|exe|msi|pkg|deb|rpm|lock|log|csv|tsv|wasm|proto|graphql|prisma|map|asar|plist|gradle|properties|conf|config|dockerfile|makefile)(?::[0-9]+)?(?:#L[0-9]+(?:-L?[0-9]+)?)?)(?:[ ]|$|["';,])/i;

    const CLI_CMD_RE = /^(?:git|npm|pnpm|yarn|bun|npx|pip3?|python3?|node|cargo|rustc|go|docker(?:-compose)?|kubectl|curl|wget|cd|ls|rm|cp|mv|mkdir|chmod|chown|cat|grep|sed|awk|find|ssh|scp|tar|zip|unzip|brew|apt|yum|systemctl|kill|ps|top|echo|export|source|which|head|tail|touch|vi|vim|nano|lsof)(?:[ ]|$)/;

    const CODE_KW_RE = /(?:(?:^|[^a-zA-Z0-9_$])(?:import[ ]+.*?from|export[ ]+(?:default|const|let|var|function|class)|def[ ]+[a-zA-Z0-9_]+[ ]*[(]|function[ ]*[a-zA-Z0-9_$]*[ ]*[(]|class[ ]+[a-zA-Z0-9_]+|return[ ]+|console[.](?:log|error|warn|info)|public[ ]+static|async[ ]+function|module[.]exports|require[ ]*[(]|typeof[ ]+[a-zA-Z0-9_$]+)(?:[^a-zA-Z0-9_$]|$)|(?:^|[^a-zA-Z0-9_$])const[ ]+|(?:^|[^a-zA-Z0-9_$])let[ ]+[a-zA-Z0-9_$\[{]+|(?:^|[^a-zA-Z0-9_$])var[ ]+[a-zA-Z0-9_$\[{]+)/;

    const CODE_SYMBOLS_RE = /(=>|===|!==|->|::|<\/|\/>|\$\{[^}]+\}|;[ ]*$)/;

    const URL_OR_PATH_RE = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|file:\/\/\/|[~/]|[.]+[\/\\]|[a-zA-Z]:[\/\\])/;

    const PATH_SLASH_RE = /(?:^|[ "'`])(?:[a-zA-Z0-9_.-]+[/\\]){1,}[a-zA-Z0-9_.-]+/;

    const DOTFILE_RE = /^[.][a-zA-Z0-9_.-]+$/;

    const CLI_FLAGS_RE = /(?:^|[ ])-{1,2}[a-zA-Z][a-zA-Z0-9_-]*/;

    const SNAKE_CASE_RE = /^[a-zA-Z0-9]+_[a-zA-Z0-9_]+$/;

    const CAMEL_CASE_RE = /^[a-z]+[A-Z0-9][a-zA-Z0-9]*$/;

    const CODE_CALL_RE = /^(?:[a-z][a-zA-Z0-9_$]*|[a-zA-Z0-9_$]+[.][a-zA-Z0-9_$]+)[ ]*[(][^)]*[)]$/;

    function isPathOrCode(raw) {
        if (!raw || typeof raw !== 'string') return false;
        const s = raw.trim();
        if (s.length === 0) return false;
        // 字典显式收录的已知 UI 字符串（如 custom_rules, Node.js 等）不予阻断
        if (map.has(s)) return false;

        if (URL_OR_PATH_RE.test(s)) return true;
        if (PATH_SLASH_RE.test(s) && !/[ ][/\\]|[/\\][ ]/.test(s)) return true;
        if (FILE_EXT_RE.test(s)) return true;
        if (DOTFILE_RE.test(s)) return true;
        if (CLI_CMD_RE.test(s)) return true;
        if (CLI_FLAGS_RE.test(s) && !/^[0-9-]+$/.test(s)) return true;
        if (CODE_KW_RE.test(s)) return true;
        if (CODE_SYMBOLS_RE.test(s)) return true;
        if (SNAKE_CASE_RE.test(s)) return true;
        if (CAMEL_CASE_RE.test(s)) return true;
        if (CODE_CALL_RE.test(s)) return true;
        return false;
    }

    // 必须与 index.mjs 的词库键归一化保持一致
    function norm(s) {
        if (!s) return '';
        return s.replace(/\s+/g, ' ')
                .replace(/[’‘]/g, "'")
                .replace(/[“”]/g, '"')
                .trim();
    }

    // 会话/项目列表项：五个特征必须同时满足。只判 select-none + cursor-pointer
    // 会把菜单栏按钮（File/View/Window）也算进去，导致菜单栏整片不翻译。
    const ROW_CLASS_SIGNATURE = ['relative', 'w-full', 'select-none', 'cursor-pointer'];
    function isConversationRow(el) {
        if (!el || el.tagName !== 'DIV') return false;
        const className = el.className;
        if (typeof className !== 'string' || !className) return false;
        const tokens = className.split(/[ ]+/);
        for (const need of ROW_CLASS_SIGNATURE) {
            if (!tokens.includes(need)) return false;
        }
        return true;
    }

    // 行内只有**标题**是用户内容，其余（时间戳、计数、徽标）是 UI 装饰，仍要翻。
    // 标题是那个 truncate span（syncConversationTitles 也是按它定位的）；
    // 时间戳走的是 text-xs opacity-60，不带 truncate。
    // 整行拉黑会让 3h / 23h 这类时间戳跟着漏翻——实测踩过。
    function isRowTitle(el) {
        if (!el || typeof el.className !== 'string') return false;
        return el.className.split(/[ ]+/).includes('truncate');
    }

    // Both text and attributes use this walk, including nested shadow roots.
    function isExcluded(node) {
        for (let curr = node; curr; curr = curr.parentNode || curr.host) {
            if (curr.id === 'agy-model-context-widget' ||
                curr.getAttribute?.('data-testid') === 'model-selector-trigger') return true;
        }
        return false;
    }
    function isInBlockedZone(node) {
        if (isExcluded(node)) return true;
        let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        let depth = 0;
        let sawRowTitle = false;
        while (curr && depth < 25) {
            if (curr.nodeType === Node.ELEMENT_NODE) {
                const tag = curr.tagName.toUpperCase();
                if (BLOCKED_TAGS.includes(tag)) return true;
                if (curr.getAttribute('contenteditable') === 'true') return true;
                if (curr.hasAttribute('data-uri')) return true;
                if (curr.hasAttribute('data-quotable-inline')) return true;
                if (curr.hasAttribute('data-quotable')) return true;
                if (curr.hasAttribute('data-lexical-editor')) return true;
                if (curr.hasAttribute('data-path') || curr.hasAttribute('data-filepath') ||
                    curr.hasAttribute('data-file-path') || curr.hasAttribute('data-filename')) return true;
                const tabId = curr.getAttribute('data-tab-id') || '';
                if (tabId.startsWith('file_') || tabId.startsWith('file:') || tabId.startsWith('/')) return true;

                if (isRowTitle(curr)) sawRowTitle = true;
                // 只有「truncate 标题 + 外层是会话行」两个条件同时成立才算用户内容
                if (sawRowTitle && isConversationRow(curr)) return true;
                const className = curr.className || '';
                if (typeof className === 'string') {
                    if (BLOCKED_CLASS_SUBSTR.some(cls => className.includes(cls))) return true;
                    const tokens = className.split(/[ ]+/);
                    if (tokens.some(t => BLOCKED_CLASS_TOKEN.includes(t))) return true;
                }
                const role = curr.getAttribute('role') || '';
                if (role === 'code' || role === 'img' || role === 'log') return true;
            }
            curr = curr.parentElement || (curr.parentNode && curr.parentNode.host);
            depth++;
        }
        return false;
    }

    // 动态文案规则：含变量（时间、数字）的句子无法穷举，用正则处理。
    // 刻意不写反斜杠转义（Python 字符串层会把它吞掉），改用 [0-9] [.] [ ] 这类等价写法。
    function cnDuration(s) {
        return s
            .replace(/([0-9]+)[ ]*days?/gi, '$1 天')
            .replace(/([0-9]+)[ ]*hours?/gi, '$1 小时')
            .replace(/([0-9]+)[ ]*minutes?/gi, '$1 分钟')
            .replace(/([0-9]+)[ ]*seconds?/gi, '$1 秒')
            .replace(/([0-9]+)[ ]*d(?![A-Za-z0-9])/gi, '$1 天')
            .replace(/([0-9]+)[ ]*h(?![A-Za-z0-9])/gi, '$1 小时')
            .replace(/([0-9]+)[ ]*m(?![A-Za-z0-9])/gi, '$1 分钟')
            .replace(/([0-9]+)[ ]*s(?![A-Za-z0-9])/gi, '$1 秒')
            .replace(/,[ ]*/g, ' ')
            .trim();
    }
    const REGEX_RULES = [
        [/^You have used (some|all) of your (5-hour|5 hour|five hour) limit, it will fully refresh in (.+?)[.]?$/i,
         (m, q, l, a) => '你已使用' + (q.toLowerCase() === 'all' ? '全部' : '部分') + '五小时限额，将在 ' + cnDuration(a) + ' 后完全刷新。'],
        [/^You have used (some|all) of your weekly limit, it will fully refresh in (.+?)[.]?$/i,
         (m, q, a) => '你已使用' + (q.toLowerCase() === 'all' ? '全部' : '部分') + '每周限额，将在 ' + cnDuration(a) + ' 后完全刷新。'],
        [/^You have reached your (5-hour|5 hour|five hour) limit, it will fully refresh in (.+?)[.]?$/i,
         (m, l, a) => '你已达到五小时限额，将在 ' + cnDuration(a) + ' 后完全刷新。'],
        [/^You have reached your weekly limit, it will fully refresh in (.+?)[.]?$/i,
         (m, a) => '你已达到每周限额，将在 ' + cnDuration(a) + ' 后完全刷新。'],
        [/^You have used (some|all) of your (.+?) limit, it will fully refresh in (.+?)[.]?$/i,
         (m, q, l, a) => '你已使用' + (q.toLowerCase() === 'all' ? '全部' : '部分') + l + '限额，将在 ' + cnDuration(a) + ' 后完全刷新。'],
        [/^Will fully refresh in (.+?)[.]?$/i,
         (m, a) => '将在 ' + cnDuration(a) + ' 后完全刷新。'],
        [/^Fully refreshes in (.+?)[.]?$/i,
         (m, a) => '将在 ' + cnDuration(a) + ' 后完全刷新。'],
        [/^Resets in (.+?)[.]?$/i,
         (m, a) => '将在 ' + cnDuration(a) + ' 后重置。'],
        [/^Send feedback as (.+)$/, (m, a) => '以 ' + a + ' 身份发送反馈'],
        [/^Select model, current: (.+)$/, (m, a) => '选择模型，当前：' + a],
        [/^(.+?) Sends immediately$/, (m, a) => a + ' 立即发送'],
        [/^(.+?) Queues after the turn$/, (m, a) => a + ' 排队等待当前轮次结束后发送'],
        [/^Worked for (.+)$/, (m, a) => '已工作 ' + cnDuration(a)],
        [/^Thought for (.+?)[.]*$/i, (m, a) => '思考了 ' + cnDuration(a)],
        [/^Thinking for (.+?)[.]*$/i, (m, a) => '正在思考 (' + cnDuration(a) + ')'],
        [/^([0-9]+) files? changed$/, (m, a) => '已修改 ' + a + ' 个文件'],
        [/^Explored ([0-9]+) files?$/, (m, a) => '已浏览 ' + a + ' 个文件'],
        [/^Ran ([0-9]+) commands?$/, (m, a) => '已运行 ' + a + ' 条命令'],
        [/^Running ([0-9]+) commands?$/i, (m, a) => '正在运行 ' + a + ' 条命令'],
        [/^Running ([0-9]+) tasks?$/i, (m, a) => '正在运行 ' + a + ' 个任务'],
        [/^([0-9]+) tasks? running$/, (m, a) => a + ' 个任务运行中'],
        [/^([0-9]+) agents? running$/i, (m, a) => a + ' 个智能体运行中'],
        [/^([0-9]+)[ ]*subagents?[/]tasks?[ ]+running$/i, (m, a) => a + ' 个子智能体/任务运行中'],
        [/^([0-9]+)[ ]*subagents?[ ]+running$/i, (m, a) => a + ' 个子智能体运行中'],
        [/^Invoking (.+?) subagent$/i, (m, a) => '正在调用 ' + (map.get(norm(a)) || lowerMap.get(norm(a).toLowerCase()) || a) + ' 子智能体'],
        [/^subagent of (.+)$/i, (m, a) => a + ' 的子智能体'],
        [/^Exploring ([0-9]+) files?, ([0-9]+) search(?:es)?, ([0-9]+) tasks?, running ([0-9]+) commands?$/i,
         (m, f, s, t, c) => '正在浏览 ' + f + ' 个文件，' + s + ' 次搜索，' + t + ' 个任务，运行 ' + c + ' 条命令'],
        [/^Exploring ([0-9]+) files?, ([0-9]+) search(?:es)?, running ([0-9]+) commands?$/i,
         (m, f, s, c) => '正在浏览 ' + f + ' 个文件，' + s + ' 次搜索，运行 ' + c + ' 条命令'],
        [/^Exploring ([0-9]+) files?, ([0-9]+) tasks?, running ([0-9]+) commands?$/i,
         (m, f, t, c) => '正在浏览 ' + f + ' 个文件，' + t + ' 个任务，运行 ' + c + ' 条命令'],
        [/^Exploring ([0-9]+) files?, ([0-9]+) tasks?$/i,
         (m, f, t) => '正在浏览 ' + f + ' 个文件，' + t + ' 个任务'],
        [/^Exploring ([0-9]+) files?, running ([0-9]+) commands?$/i,
         (m, f, c) => '正在浏览 ' + f + ' 个文件，运行 ' + c + ' 条命令'],
        [/^Exploring ([0-9]+) files?$/i,
         (m, f) => '正在浏览 ' + f + ' 个文件'],
        [/^([0-9]+) files?, ([0-9]+) search(?:es)?$/, (m, a, b) => a + ' 个文件，' + b + ' 次搜索'],
        [/^([0-9]+) files?$/, (m, a) => a + ' 个文件'],
        [/^([0-9]+) commands?$/, (m, a) => a + ' 条命令'],
        [/^([0-9]+) search(?:es)?$/, (m, a) => a + ' 次搜索'],
        [/^([0-9]+) tools?$/, (m, a) => a + ' 个工具'],
        [/^([0-9]+) projects?$/i, (m, a) => a + ' 个项目'],
        [/^(?:Load|Showing) older messages, showing ([0-9]+) of ([0-9]+)$/i, (m, a, b) => '加载更早的消息，显示 ' + a + ' / ' + b + ' 条'],
        [/^No more older messages, showing ([0-9]+) of ([0-9]+)$/i, (m, a, b) => '没有更早的消息了，显示 ' + a + ' / ' + b + ' 条'],
        [/^Showing ([0-9]+) of ([0-9]+) messages$/i, (m, a, b) => '显示 ' + a + ' / ' + b + ' 条消息'],
        [/^Showing ([0-9]+) of ([0-9]+)$/i, (m, a, b) => '显示 ' + a + ' / ' + b + ' 条'],
        [/^[(]([0-9,]+)[ ]*tokens?[)]$/i, (m, a) => '(' + a + ' Token)'],
        [/^[(]([0-9,]+)[ ]*tokens?[)][ ]*(.+)$/i, (m, a, rest) => '(' + a + ' Token) ' + rest],
        [/^([0-9,]+)[ ]*tokens?$/i, (m, a) => a + ' Token'],
        [/^([0-9,]+)[ ]*tokens?[ ]*(.+)$/i, (m, a, rest) => a + ' Token ' + rest],
        [/^(?:Show|View)[ ]+([0-9]+)[ ]+breakdowns?$/i, (m, a) => '显示 ' + a + ' 项明细'],
        [/^Hide[ ]+([0-9]+)[ ]+breakdowns?$/i, (m, a) => '隐藏 ' + a + ' 项明细'],
        [/^(?:Show|View)[ ]+breakdowns?$/i, () => '显示明细'],
        [/^Hide[ ]+breakdowns?$/i, () => '隐藏明细'],
        [/^Rules[ ]+([0-9]+)$/i, (m, a) => '规则 ' + a],
        [/^Skills[ ]+([0-9]+)$/i, (m, a) => '技能 ' + a],
        [/^MCP Servers[ ]+([0-9]+)$/i, (m, a) => 'MCP 服务器 ' + a],
        [/^Search ([A-Za-z0-9 _-]+) by name(?: or description)?[.][.][.]?$/i, (m, target) => '按名称搜索 ' + (map.get(norm(target)) || lowerMap.get(norm(target).toLowerCase()) || target) + '...'],
        [/^Permanently delete (.+?)[.]?$/i, (m, name) => '永久删除 ' + name.replace(/[.]+$/, '') + '。'],
        [/^Cloud CLI MCP Server provides tools to run gcloud and bq CLI ?commands.*$/i, () => 'Cloud CLI MCP 服务器提供在远程沙箱环境中运行 gcloud 和 bq CLI 命令的工具。'],
        [/^The ([A-Za-z0-9 ._-]+) remote MCP server lets you access and run ([A-Za-z0-9 ._-]+) tools.*$/i, (m, name, tool) => name + ' 远程 MCP 服务器允许你访问并运行 ' + tool + ' 工具以进行管理和操作。'],
        [/^The ([A-Za-z0-9 ._-]+) remote MCP server lets you manage ([A-Za-z0-9 ._-]+) resources[.]?$/i, (m, name, res) => name + ' 远程 MCP 服务器允许你管理 ' + res + ' 资源。'],
        [/^The ([A-Za-z0-9 ._-]+) Model Context Protocol [(]MCP[)] [Ss]erver gives AI-powered development tools the ability to (.*)$/i, (m, name, rest) => name + ' 模型上下文协议 (MCP) 服务器让 AI 开发工具能够' + rest],
        [/^(?:All |全部|所有)?(?:定时任务|scheduled tasks?)[s]?[ ]+runs?[ ]+as[ ]+(.*)$/i, (m, model) => '所有定时任务均以 ' + model.replace(/[.]+$/, '').trim() + ' 模型运行。'],
        [/^to be installed[.][ ]*(.*)$/i, (m, rest) => '。' + (rest ? (rest.startsWith(' ') ? rest : ' ' + rest) : '')],
        [/^By using this app, you agree to its (?:the |its |our )?(.+)$/i, (m, a) => '使用此应用即表示你同意其' + (map.get(norm(a)) || lowerMap.get(norm(a).toLowerCase()) || a)],
        [/^By using (.+?), you agree to its$/i, (m, app) => '使用 ' + app + ' 即表示你同意其'],
        [/^By using (.+?), you agree to its (?:the |its |our )?(.+)$/i, (m, app, a) => '使用 ' + app + ' 即表示你同意其' + (map.get(norm(a)) || lowerMap.get(norm(a).toLowerCase()) || a)],
        [/^By continuing, you agree to (?:the |its |our )?(.+)$/i, (m, a) => '继续即表示你同意' + (map.get(norm(a)) || lowerMap.get(norm(a).toLowerCase()) || a)],
        // 'By clicking Continue, you agree to' 在字典里是半截短语（34 字符 >= 30），
        // 会参与子串替换，把整句译成「点击"继续"即表示你同意 the Privacy Policy」这种混杂。
        // 用正则接住完整句，把后半截回查字典。
        [/^By clicking ([A-Za-z ]+?), you agree to (?:the |its |our )?(.+)$/i,
         (m, btn, a) => '点击“' + (map.get(norm(btn)) || lowerMap.get(norm(btn).toLowerCase()) || btn)
                        + '”即表示你同意' + (map.get(norm(a)) || lowerMap.get(norm(a).toLowerCase()) || a)],
        [/^By signing in, you agree to (?:the |its |our )?(.+)$/i, (m, a) => '登录即表示你同意' + (map.get(norm(a)) || lowerMap.get(norm(a).toLowerCase()) || a)],
        [/^Available AI Credits:[ ]*(.*)$/i, (m, val) => '可用 AI 点数：' + val],
        [/^(?:否|无)?(?:项目|projects?)[ ]+found[.]?$/i, () => '未找到项目'],
        [/^No ([A-Za-z0-9 _-]+?)s?[ ]+found[.]?$/i, (m, what) => '未找到' + (map.get(norm(what)) || lowerMap.get(norm(what).toLowerCase()) || what)],
        [/^(Projects|Conversations|Workspaces|Tasks|Files)[ ]*[(](Status|Worktree|Workspace|Date|Time|Type|Category)[)][ ]*([>›»]?)$/i, (m, a, b, arrow) => (map.get(norm(a)) || a) + ' (' + (map.get(norm(b)) || b) + ')' + (arrow ? ' ' + arrow : '')],
        [/^Scan the (?:QR )?code to open this device in ([A-Za-z0-9 _-]+),?[ ]+or[ ]*$/i, (m, target) => '扫描二维码在“' + (map.get(norm(target)) || lowerMap.get(norm(target).toLowerCase()) || target) + '”中打开此设备，或 '],
        [/^Scan the (?:QR )?code to open this device in ([A-Za-z0-9 _-]+)[.]?$/i, (m, target) => '扫描二维码在“' + (map.get(norm(target)) || lowerMap.get(norm(target).toLowerCase()) || target) + '”中打开此设备。'],
        // 界面里有一批标题是 `Open ${config.title}` 模板拼出来的（如 Open Remote Control），
        // JS 里没有完整字面量，字典永远命不中，会掉到逐词翻译译出「打开远程 Control」
        // 这种中英混杂。这里把后半截回查字典；查不到就整体保留英文，
        // 也比半中半英好。已有精确条目（Open Changes → 查看变更）在第 1 级命中，走不到这。
        [/^Open ([A-Za-z0-9][A-Za-z0-9 ._-]{1,40})$/, (m, target) => {
            const hit = map.get(norm(target)) || lowerMap.get(norm(target).toLowerCase());
            return hit ? '打开' + hit : m;
        }],
        [/^Fold lines?[ ]+([0-9]+)(?:-([0-9]+))?$/i, (m, a, b) => '折叠第 ' + a + (b ? '-' + b : '') + ' 行'],
        [/^Unfold lines?[ ]+([0-9]+)(?:-([0-9]+))?$/i, (m, a, b) => '展开第 ' + a + (b ? '-' + b : '') + ' 行'],
        [/^User uploaded media ([0-9]+)$/i, (m, a) => '用户上传媒体 ' + a],
        [/^确定要删除 (?:this |the )?(?:conversation|对话)[?][ ]*This action cannot be undone[.] 吗[？?]$/i, () => '确定要删除此对话吗？此操作无法撤销。'],
        [/^Are you sure you want to delete (?:the |this )?(conversation|project|workspace|task|file|item)[?][ ]*This action cannot be undone[.]?$/i, (m, type) => '确定要删除此' + (map.get(norm(type)) || lowerMap.get(norm(type).toLowerCase()) || type) + '吗？此操作无法撤销。'],
        [/^Are you sure you want to delete (?:the |this )?([^?]+)[?][ ]*This action cannot be undone[.]?$/i, (m, target) => '确定要删除 ' + target + ' 吗？此操作无法撤销。'],
        [/^Are you sure you want to delete (?:the |this )?(?:项目|project|workspace)[ ]+([^?]+)[?]?$/i, (m, name) => '确定要删除项目 ' + name.replace(/[?]+$/, '').trim() + ' 吗？'],
        [/^Are you sure you want to delete (?:the |this )?(conversation|project|workspace|task|file|folder|message|item)[?]?$/i, (m, type) => '确定要删除此' + (map.get(norm(type)) || lowerMap.get(norm(type).toLowerCase()) || type) + '吗？'],
        [/^Are you sure you want to delete (?:the |this )?([^?]+)[?]?$/i, (m, target) => '确定要删除 ' + target.replace(/[?]+$/, '').trim() + ' 吗？'],
        [/^Are you sure you want to delete (?:the |this )?(?:项目|project|workspace)?$/i, () => '确定要删除项目 '],
        [/^Are you sure you want to mark all ([0-9]+) conversations as read[?][ ]*This action cannot be undone[.]?$/i, (m, a) => '确定要将所有 ' + a + ' 个对话标记为已读吗？此操作无法撤销。'],
        [/^Are you sure you want to delete the hook "(.+?)"[?]$/i, (m, a) => '确定要删除钩子 "' + a + '" 吗？'],
        [/^There was an error determining the code changes that this undo action will make: (.+)$/i, (m, a) => '确定此撤销操作将产生的代码更改时出错：' + a],
        [/^Are you sure you want to delete (?:the |this )?([^?]+)[?][ ]*This will remove it from your MCP configuration[.]?$/i, (m, a) => '确定要删除 ' + a + ' 吗？这将把它从你的 MCP 配置中移除。'],
        [/^Are you sure you want to archive the (?:workspace|environment) (.+)[?]$/i, (m, a) => '确定要归档 ' + a + ' 吗？'],
        [/^Yes, and always allow (.+) in this conversation$/, (m, a) => '是，且在当前对话中始终允许 ' + a],
        [/^Yes, and always allow (.+) when not in a project$/, (m, a) => '是，且在非项目状态下始终允许 ' + a],
        [/^Yes, and always allow (.+) in this workspace$/, (m, a) => '是，且在此工作区中始终允许 ' + a],
        [/^Yes, and always allow (.+)$/, (m, a) => '是，且始终允许 ' + a],
        [/^Proceed with implementation plan and ([0-9]+) comments?$/i, (m, a) => '按实施计划及 ' + a + ' 条批注继续'],
        [/^Auto-proceeded with (.+)$/i, (m, a) => '已自动继续执行 ' + a],
        [/^Proceeded with (.+)$/i, (m, a) => '已继续执行 ' + a],
        [/^Run (.+?) finished$/i, (m, a) => '运行 ' + a + ' 已完成'],
        [/^See all[ ]*[(]([0-9]+)[)]$/i, (m, a) => '查看全部 (' + a + ')'],
        [/^Show all[ ]*[(]([0-9]+)[)]$/i, (m, a) => '显示全部 (' + a + ')'],
        [/^See all[ ]*[(]$/i, () => '查看全部 ('],
        [/^Show all[ ]*[(]$/i, () => '显示全部 ('],
        [/^([0-9]+)[ ]*Files?[ ]*With Changes$/i, (m, a) => a + ' 个有变更的文件'],
        [/^([0-9]+)[ ]*Files?[ ]*Changed$/i, (m, a) => a + ' 个已修改文件'],
        [/^([0-9]+)[ ]*Files?[ ]*changed$/i, (m, a) => a + ' 个已修改文件'],
        [/^Files?[ ]*Changed$/i, () => '已修改文件'],
        [/^Files?[ ]*With Changes$/i, () => '有变更的文件'],
        [/^Working[.][.][.] Requesting permission to run (.+)$/, (m, a) => '运行中... 正在请求权限以运行 ' + a],
        [/^Ran ([0-9]+) commands? Explored ([0-9]+) tasks?$/, (m, a, b) => '已运行 ' + a + ' 条命令，已浏览 ' + b + ' 个任务'],
        [/^Ran ([0-9]+) commands? Working[.][.][.]$/, (m, a) => '已运行 ' + a + ' 条命令 运行中...'],
        [/^Explored ([0-9]+) files? Working[.][.][.]$/, (m, a) => '已浏览 ' + a + ' 个文件 运行中...'],
        [/^Updated[ ]+([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:[ ]*[AaPp][Mm])?)$/i, (m, t) => '更新于 ' + t],
        [/^Updated[ ]+([0-9]+[ ]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ ]*[0-9]*)$/i, (m, d) => '更新于 ' + d],
        [/^Created[ ]+([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:[ ]*[AaPp][Mm])?)$/i, (m, t) => '创建于 ' + t],
        [/^Created[ ]+([0-9]+[ ]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ ]*[0-9]*)$/i, (m, d) => '创建于 ' + d],
        [/^Mark ([0-9]+) conversations? as (read|unread)$/i, (m, count, state) => '将 ' + count + ' 个对话标记为' + (state.toLowerCase() === 'read' ? '已读' : '未读')],
        [/^Mark all(?: conversations)? as (read|unread)$/i, (m, state) => '将全部对话标记为' + (state.toLowerCase() === 'read' ? '已读' : '未读')],
        [/^Exposes? ([0-9]+) tools?[,]?[ ]*and[ ]*([0-9]+) resources?[.]?$/i, (m, a, b) => '暴露 ' + a + ' 个工具和 ' + b + ' 个资源'],
        [/^Exposes? ([0-9]+) (tools?|resources?|prompts?)[.]?$/i, (m, count, type) => '暴露 ' + count + ' 个' + (type.toLowerCase().includes('tool') ? '工具' : (type.toLowerCase().includes('resource') ? '资源' : '提示词'))],
        [/^Command exited with code ([0-9]+)[.]?$/i, (m, code) => '命令已退出（返回码 ' + code + '）'],
        [/^([0-9,]+)[ ]+(input|output|cached)[ ]+tokens?$/i, (m, count, type) => count + ' ' + (type.toLowerCase() === 'input' ? '输入' : (type.toLowerCase() === 'output' ? '输出' : '缓存')) + ' Token'],
        [/^([0-9]+)d$/, (m, a) => a + ' 天前'],
        [/^([0-9]+)h$/, (m, a) => a + ' 小时前'],
        [/^([0-9]+)m$/, (m, a) => a + ' 分钟前'],
        [/^([0-9]+)s$/, (m, a) => a + ' 秒前'],
        [/^(.+?) - Outside of Project - Antigravity$/i, (m, title) => title + ' - 非项目状态 - Antigravity'],
        [/^(.+?) - Outside of Project$/i, (m, title) => title + ' - 非项目状态'],
        [/^Requesting permission to run (.+)$/, (m, a) => '正在请求权限以运行 ' + a],
    ];
    function applyRegexRules(text) {
        const folded = text.toLowerCase();
        let exact = exactPhrases.get(text) ?? foldedPhrases.get(folded);
        // Only rules that originally ended in an optional period accept one trailing dot.
        if (exact === undefined && text.endsWith('.')) {
            const stripped = text.slice(0, -1);
            const foldedStripped = folded.slice(0, -1);
            if (periodExact.has(stripped)) exact = exactPhrases.get(stripped);
            else if (periodFolded.has(foldedStripped)) exact = foldedPhrases.get(foldedStripped);
        }
        if (exact !== undefined) return exact;
        for (const [prefix, translation] of prefixPhrases) {
            if (folded.startsWith(prefix)) return translation;
        }
        for (const [re, fn] of REGEX_RULES) {
            if (re.test(text)) return text.replace(re, fn);
        }
        return text;
    }

    const TITLE_WORD_MAP = TITLE_WORDS_PLACEHOLDER;

    const STEM_SUFFIXES = STEM_SUFFIXES_PLACEHOLDER;

    // 两遍查询：先把 TITLE_WORD_MAP（原形 + 全部词干变体）穷尽，再回退字典。
    // 不能把两个来源交错在一个循环里——那样 'packages' 会先撞上字典的 '包'，
    // 而 'package' 直接命中词表的 '依赖包'，同一个词的单复数译出两个结果。
    // 逐词查询的 memo：界面上同一批单词反复出现（Settings/File/Open/Delete…），
    // 未命中时需要遍历词干后缀表，缓存避免对同一个词重复查询。
    // 缓存单词级结果（含"查不到"这个结论，用 null 表示），命中后是一次 Map 查询。
    // 单词集合有限（界面词汇量），不会无界增长；上限兜底防异常输入刷爆。
    const wordCache = new Map();
    const WORD_CACHE_MAX = 4000;

    function lookupWord(clean) {
        if (wordCache.has(clean)) return wordCache.get(clean);
        const r = lookupWordUncached(clean);
        if (wordCache.size < WORD_CACHE_MAX) wordCache.set(clean, r);
        return r;
    }

    function lookupWordUncached(clean) {
        if (TITLE_WORD_MAP[clean]) return TITLE_WORD_MAP[clean];
        for (const [suffix, rep] of STEM_SUFFIXES) {
            if (!clean.endsWith(suffix)) continue;
            const stem = clean.slice(0, -suffix.length) + rep;
            if (!stem) continue;
            if (TITLE_WORD_MAP[stem]) return TITLE_WORD_MAP[stem];
            if (TITLE_WORD_MAP[stem + 'e']) return TITLE_WORD_MAP[stem + 'e'];
        }
        if (lowerMap.has(clean) && lowerMap.get(clean).length <= 12) return lowerMap.get(clean);
        for (const [suffix, rep] of STEM_SUFFIXES) {
            if (!clean.endsWith(suffix)) continue;
            const stem = clean.slice(0, -suffix.length) + rep;
            if (stem && lowerMap.has(stem) && lowerMap.get(stem).length <= 12) return lowerMap.get(stem);
        }
        return null;
    }

    const TECH_IDENTIFIERS = new Set([
        'claude', 'gemini', 'gpt', 'ui', 'api', 'sdk', 'ide', 'mcp', 'git', 'css', 'html', 'js', 'ts',
        'python', 'node', 'vue', 'react', 'docker', 'linux', 'macos', 'windows', 'redis', 'postgres',
        'mysql', 'mongodb', 'sqlite', 'kafka', 'nginx', 'aws', 'gcp', 'azure', 'kubernetes', 'k8s',
        'java', 'rust', 'go', 'golang', 'cpp', 'php', 'ruby', 'spring', 'fastapi', 'flask', 'django',
        'codex', 'vibebar'
    ]);

    const STOPWORDS = {
        'the': '', 'a': '', 'an': '', 'of': '', 'for': '', 'with': '与',
        'in': '', 'on': '', 'and': '与', 'to': '到', 'from': '来自', 'by': '由',
        'into': '入'
    };

    function translatePhraseTokens(text) {
        if (!text || text.length > 70) return text;
        const tokens = text.trim().split(/[ ]+/);
        if (tokens.length < 1 || tokens.length > 10) return text;

        if (tokens.length === 1) {
            const tok = tokens[0];
            const clean = tok.toLowerCase().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
            if (!clean) return text;
            const looked = lookupWord(clean);
            return looked || text;
        }

        const translated = [];
        let hasTranslatedWord = false;
        for (const tok of tokens) {
            const clean = tok.toLowerCase().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
            if (!clean) continue;
            if (STOPWORDS[clean] !== undefined) {
                if (STOPWORDS[clean]) translated.push(STOPWORDS[clean]);
            } else {
                const looked = lookupWord(clean);
                if (looked) {
                    translated.push(looked);
                    hasTranslatedWord = true;
                } else if (map.has(tok)) {
                    translated.push(map.get(tok));
                    hasTranslatedWord = true;
                } else if (/^[0-9.]+$/.test(tok)) {
                    translated.push(tok);
                } else if ((tok.length >= 2 && tok === tok.toUpperCase()) || TECH_IDENTIFIERS.has(clean) || tok.includes('_') || tok.includes('-') || tok.includes('.')) {
                    translated.push(tok);
                } else {
                    return text;
                }
            }
        }
        if (!hasTranslatedWord || translated.length === 0) return text;
        let res = '';
        for (let i = 0; i < translated.length; i++) {
            if (i > 0) {
                const prev = translated[i - 1];
                const cur = translated[i];
                if (/[A-Za-z0-9]$/.test(prev) || /^[A-Za-z0-9]/.test(cur)) {
                    res += ' ';
                }
            }
            res += translated[i];
        }
        return res;
    }

    function translateAttrValue(raw) {
        if (!raw || typeof raw !== 'string') return null;
        if (isPathOrCode(raw)) return null;
        const t = norm(raw);
        if (!t) return null;
        if (map.has(t)) return map.get(t);
        const low = t.toLowerCase();
        if (lowerMap.has(low) && t.length < 30 && (low.includes(' ') || t !== low)) return lowerMap.get(low);
        const byRegex = applyRegexRules(t);
        if (byRegex !== t) return byRegex;
        return null;
    }

    // ---- 原文暂存：让「上一版引擎译错的地方」能被新引擎救回 ----
    //
    // 文本节点挂不了属性，所以存在父元素上，按它在 childNodes 里的下标做键：
    //   data-ag-i18n = {"2": ["Open Remote Control", "打开远程 Control"]}
    // 同时存原文与当时写下的译文。还原前要求当前值仍等于那个译文——
    // 这样 React 重渲染换掉节点后，陈旧的暂存不会把无关文本改掉。
    // 这个属性不在 TRANSLATABLE_ATTRS 里，所以不会触发 observer 的 attributeFilter。
    const STASH_ATTR = 'data-ag-i18n';

    function stashOriginal(node, original, translated) {
        try {
            const el = node.parentElement;
            if (!el) return;
            const idx = [].indexOf.call(el.childNodes, node);
            if (idx < 0) return;
            let obj = {};
            const raw = el.getAttribute(STASH_ATTR);
            if (raw) { try { obj = JSON.parse(raw) || {}; } catch (e) { obj = {}; } }
            obj[idx] = [original, translated];
            el.setAttribute(STASH_ATTR, JSON.stringify(obj));
        } catch (e) {}
    }

    // 还原成功返回 true（调用方要重读 nodeValue），没还原返回 false。
    // 不在这里动 lastSeen：调用方只在 !lastSeen.has(node) 时才调它，
    // 动了反而会破坏早退阻尼。
    function restoreOriginal(node) {
        try {
            const el = node.parentElement;
            if (!el) return false;
            const raw = el.getAttribute(STASH_ATTR);
            if (!raw) return false;
            let obj;
            try { obj = JSON.parse(raw); } catch (e) { return false; }
            if (!obj) return false;
            const idx = [].indexOf.call(el.childNodes, node);
            const rec = obj[idx];
            if (!rec) return false;
            // 只有当前值仍是我们写下的那个译文时才还原，否则说明内容已被应用改过
            if (node.nodeValue === rec[1] && rec[0] !== rec[1]) {
                node.nodeValue = rec[0];
                return true;
            }
        } catch (e) {}
        return false;
    }

    // 单个元素的属性翻译，带 memo：值没变就整条跳过。
    // 属性不查禁区——它是 UI 元数据而非用户输入，查了会漏翻输入框提示。
    function translateAttrs(el) {
        if (isExcluded(el)) return;
        let seen = attrSeen.get(el);
        for (const attr of TRANSLATABLE_ATTRS) {
            const v = el.getAttribute(attr);
            if (!v) continue;
            if (seen && seen[attr] === v) continue;   // 上一轮处理过且没变
            const t = translateAttrValue(v);
            const final = (t !== null && t !== v) ? t : v;
            if (final !== v) el.setAttribute(attr, final);
            if (!seen) { seen = {}; attrSeen.set(el, seen); }
            seen[attr] = final;
        }
    }

    function translateNode(node) {
        try {
            if (!node || isExcluded(node)) return;

            if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                observer.observe(node, obsOpts);
                for (const child of node.childNodes) translateNode(child);
                return;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toUpperCase();

                translateAttrs(node);

                if (BLOCKED_TAGS.includes(tag)) return;

                if (node.shadowRoot) translateNode(node.shadowRoot);
                for (const child of node.childNodes) translateNode(child);

            } else if (node.nodeType === Node.TEXT_NODE) {
                let originalVal = node.nodeValue;
                if (!originalVal || originalVal.trim().length < 1) return;

                // lastSeen 的早退必须在还原之前。
                // observer 听 characterData，每次写 nodeValue 都会回调进来；
                // 若在早退前还原，就成了「还原→译→还原→译」的死循环，把渲染进程挂死
                // （实测过：注入后 CDP 完全不响应）。lastSeen 就是那道阻尼。
                if (lastSeen.get(node) === originalVal) return;

                // 只在本引擎还没处理过这个节点时才尝试还原（新引擎的 lastSeen 是空的）。
                // 上一版引擎可能把它译错了（词条不全时逐词译出「打开远程 Control」这种
                // 中英混杂）；译文写回 DOM 后原文就没了，改坏的文本匹配不上任何词条，
                // 光重新注入救不回来。所以带原文一起存，新引擎还原后重译。
                if (!lastSeen.has(node) && restoreOriginal(node)) {
                    originalVal = node.nodeValue;
                }
                if (!/[A-Za-z]/.test(originalVal)) { lastSeen.set(node, originalVal); return; }
                if (isInBlockedZone(node)) { lastSeen.set(node, originalVal); return; }
                if (isPathOrCode(originalVal)) { lastSeen.set(node, originalVal); return; }

                let newVal = originalVal;
                const valNorm = norm(originalVal);
                const valLower = valNorm.toLowerCase();

                if (map.has(valNorm)) {
                    newVal = map.get(valNorm);
                } else if (lowerMap.has(valLower) && valLower.length < 30 && (valLower.includes(' ') || valNorm !== valLower)) {
                    newVal = lowerMap.get(valLower);
                } else {
                    const byRegex = applyRegexRules(valNorm);
                    if (byRegex !== valNorm) {
                        newVal = byRegex;
                    } else if (!isProtected(valNorm)) {
                        newVal = smartReplace(valNorm);
                    }
                }

                if (newVal !== originalVal && newVal !== valNorm) {
                    stashOriginal(node, originalVal, newVal);
                    node.nodeValue = newVal;
                    lastSeen.set(node, newVal);
                } else {
                    lastSeen.set(node, originalVal);
                }
            }
        } catch (e) {}
    }

    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            if (m.type === 'childList') {
                for (const n of m.addedNodes) translateNode(n);
            } else if (m.type === 'characterData') {
                translateNode(m.target);
            } else if (m.type === 'attributes' && m.target) {
                translateNode(m.target);
            }
        }
    });

    const obsOpts = {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: TRANSLATABLE_ATTRS
    };

    // 补扫 translateNode 递归到不了的属性：BLOCKED_TAGS 的子树会被 return 掉，
    // 但里面的 INPUT placeholder 之类仍需翻译。走同一个 translateAttrs，
    // 因此享受同一份 memo——同一轮里已处理过的元素在这里是纯查表跳过。
    function rescanAttributes() {
        if (!document.body) return;
        const sel = TRANSLATABLE_ATTRS.map(a => '[' + a + ']').join(',');
        for (const el of document.body.querySelectorAll(sel)) {
            if (!el.isConnected) continue;
            translateAttrs(el);
        }
    }

    function updateTitle() {
        try {
            const cur = document.title;
            if (cur && /[A-Za-z]/.test(cur)) {
                if (isPathOrCode(cur)) return;
                const normCur = norm(cur);
                if (map.has(normCur)) {
                    document.title = map.get(normCur);
                } else {
                    const byRegex = applyRegexRules(normCur);
                    if (byRegex !== normCur) {
                        document.title = byRegex;
                    } else if (!isProtected(normCur)) {
                        const rep = smartReplace(normCur);
                        if (rep !== normCur) document.title = rep;
                    }
                }
            }
        } catch (e) {}
    }

    const CONV_TITLES = CONV_TITLES_PLACEHOLDER;
    const dynamicTitles = Object.assign({}, CONV_TITLES);
    const CHINESE_CHAR_RE = new RegExp('[\u4e00-\u9fa5]');

    function distillTitle(raw) {
        if (!raw) return '';
        const lines = raw.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
        if (lines.length === 0) return '';
        const firstLine = lines[0];
        const clauses = firstLine.split(/[，。！？\n；,!?\r\t|/]/).map(s => s.trim()).filter(Boolean);
        if (clauses.length === 0) return '';
        let core = clauses[0];

        const prefixPatterns = [
            /^(请帮我|帮我|请你|请问|请|麻烦帮我|麻烦|我想|我需要|看一下|看下|查一下|查找|能否|能不能|如何|怎么|测试一下|写一个|做一个|实现一个|开发一个|搞一个|弄一个|快速|帮我分析一下|分析一下)+/,
            /^(做一下|做个|写个|弄个|查个)+/,
            /^(针对|关于|这个)+/
        ];

        let changed = true;
        while (changed) {
            changed = false;
            for (const pat of prefixPatterns) {
                const newCore = core.replace(pat, '').trim();
                if (newCore !== core && newCore.length >= 2) {
                    core = newCore;
                    changed = true;
                }
            }
        }

        core = core.replace(/[\?？\.\!！,，_—\-:：]+$/, '').trim();
        if (core.length > 15) {
            let trimmed = core.slice(0, 15);
            if (core[14] && /[A-Za-z0-9]/.test(core[14]) && /[A-Za-z0-9]/.test(core[15])) {
                const lastSpace = trimmed.lastIndexOf(' ');
                if (lastSpace >= 6) trimmed = trimmed.slice(0, lastSpace).trim();
            }
            core = trimmed;
        }
        return core;
    }

    // lastSeen 的键是「文本节点」，不是元素。这里写完标题后要标记 span 底下的
    // 文本节点，否则 translateNode 下一轮照样处理它——标记在 span 元素上永远读不到。
    function markHandled(el, value) {
        try {
            lastSeen.set(el, value);
            for (const child of el.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) lastSeen.set(child, child.nodeValue);
            }
        } catch (e) {}
    }

    function syncConversationTitles() {
        try {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
                return;
            }

            const path = window.location.pathname || '';
            const matchCid = path.match(/\/c\/([a-f0-9-]+)/);
            const curCid = matchCid ? matchCid[1] : null;
            if (curCid && !dynamicTitles[curCid]) {
                const firstUserMsg = document.querySelector('div[class*="group/user-input"], div[class*="user-input"]');
                if (firstUserMsg) {
                    const text = (firstUserMsg.innerText || '').trim();
                    if (CHINESE_CHAR_RE.test(text)) {
                        const distilled = distillTitle(text);
                        if (distilled) dynamicTitles[curCid] = distilled;
                    } else if (text.length >= 2) {
                        const trans = translatePhraseTokens(text.split(/[\r\n]+/)[0]);
                        if (trans && trans !== text) dynamicTitles[curCid] = trans.slice(0, 15);
                    }
                }
            }

            for (const a of document.querySelectorAll('a[href*="/c/"]')) {
                const href = a.getAttribute('href') || '';
                const match = href.match(/\/c\/([a-f0-9-]+)/);
                if (!match) continue;
                const cid = match[1];
                const row = a.closest('div.relative') || a.parentElement;
                if (!row) continue;
                const span = row.querySelector('span.truncate') || row.querySelector('span');
                if (!span) continue;

                const curSpanText = (span.innerText || '').trim();
                const ariaLabel = (a.getAttribute('aria-label') || '').trim();

                // 1. 最高优先级：用户手动重命名（aria-label 含中文或用户自定名称），绝不覆盖！
                if (ariaLabel && CHINESE_CHAR_RE.test(ariaLabel)) {
                    if (curSpanText !== ariaLabel) {
                        span.innerText = ariaLabel;
                        markHandled(span, ariaLabel);
                    }
                    continue;
                }

                // 2. 只有当前标题还是英文或未汉化时，才用提炼或词库标题替换
                const targetTitle = dynamicTitles[cid];
                if (targetTitle && curSpanText !== targetTitle && (!CHINESE_CHAR_RE.test(curSpanText) || /[A-Za-z]{4,}/.test(curSpanText))) {
                    span.innerText = targetTitle;
                    markHandled(span, targetTitle);
                }
            }

            if (curCid) {
                const activeA = document.querySelector('a[href*="/c/' + curCid + '"]');
                const aria = activeA ? (activeA.getAttribute('aria-label') || '').trim() : '';
                const titleToUse = (aria && CHINESE_CHAR_RE.test(aria)) ? aria : dynamicTitles[curCid];
                if (titleToUse && document.title !== titleToUse) {
                    document.title = titleToUse;
                }
            }
        } catch (e) {}
    }

    let started = false;
    let stopped = false;
    const startEngine = () => {
        if (started || stopped || !document.body) return;
        started = true;
        observer.observe(document.body, obsOpts);
        const titleEl = document.querySelector('title');
        if (titleEl) observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
        translateNode(document.body);
        updateTitle();
        syncConversationTitles();
    };

    const origAttachShadow = Element.prototype.attachShadow;
    const hooked = function () {
        const sr = origAttachShadow.apply(this, arguments);
        if (!stopped && !isExcluded(this)) observer.observe(sr, obsOpts);
        return sr;
    };
    // 全量重扫：一轮 = translateNode(整棵 body) + updateTitle + rescanAttributes
    // + syncConversationTitles。窗口不可见时这一轮纯属白烧 CPU——界面没人看，
    // DOM 也基本不动。document.hidden 时跳过，切回前台再补一轮。
    // MutationObserver 始终挂着，所以隐藏期间真有 DOM 变化仍会被实时翻译，
    // 跳过重扫不会漏翻。
    const fullSweep = () => {
        if (stopped) return;
        startEngine();
        if (document.body) translateNode(document.body);
        updateTitle();
        rescanAttributes();
        syncConversationTitles();
    };
    // 从后台切回前台：立刻补一轮，不等下一个 tick
    const onVisibilityChange = () => {
        if (!document.hidden) fullSweep();
    };
    let timerId;
    const timers = [];
    // Publish the owner before acquiring resources, so partial startup can unwind.
    window.__ag_hanhua_engine__ = {
        observe: (root) => observer.observe(root, obsOpts),
        disconnect: () => {
            stopped = true;
            if (Element.prototype.attachShadow === hooked) Element.prototype.attachShadow = origAttachShadow;
            try { observer.disconnect(); } catch (e) {}
            try { clearInterval(timerId); } catch (e) {}
            timers.forEach(clearTimeout);
            document.removeEventListener('DOMContentLoaded', startEngine);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        }
    };
    try {
        Element.prototype.attachShadow = hooked;
        document.addEventListener('visibilitychange', onVisibilityChange);
        startEngine();
        if (!started) document.addEventListener('DOMContentLoaded', startEngine, { once: true });
        timers.push(setTimeout(startEngine, 300));
        timers.push(setTimeout(fullSweep, 2000), setTimeout(fullSweep, 5000));
        timerId = setInterval(() => { if (!document.hidden) fullSweep(); }, 2000);
    } catch (error) {
        window.__ag_hanhua_engine__.disconnect();
        delete window.__ag_hanhua_engine__;
        throw error;
    }
})();
