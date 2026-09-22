# 汉化来源与集成

来源为本次用户提供的 `Antigravity_汉化_Windows分享版/Antigravity 汉化 (Windows版)`，原说明版本 Windows v2.1.0。`localization_client.js` 静态提取自 `core/jack.py` 的 `build_engine_js` 字符串。`dicts/common.json` 与 `dicts/ui_v2.json` 原样复制；整句词条在 `dicts/phrases.json`，标题词表和词干后缀在 `data/`。未执行原包的压缩 Python 程序。

原文件声明 `Copyright (c) 2026. All rights reserved.`，该声明保留；此目录的上游汉化引擎和词库不因整合而重新声明为项目的 MIT 授权。

集成使用 Node.js 标准库加载词库，复用根层守护的本机 CDP、页面身份检查、单实例和重连，不再启动原包的 Python、端口扫描、通知或自启安装脚本。引擎与词库的内容哈希用于判断是否需要重新注入。

保留上游页面翻译与页面内标题处理；会话数据库标题映射传入空对象，不读取本机对话数据库。集成增加上下文挂件、模型选择器的翻译隔离，以及重注入/退出时的定时器和事件监听清理。词库修改后需完全退出客户端、等待守护退出，再重新启动。

`npm run check` 的 `localization.installed` 表示当前引擎版本是否已注入；汉化错误单独输出在 `localization.message`，不会阻止上下文挂件注入。移除会停止监听，已翻译文字需重载页面或重启客户端恢复。
