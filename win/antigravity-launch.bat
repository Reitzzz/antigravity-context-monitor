@echo off
rem 启动 Antigravity 并伴随启动上下文监控组件
set HTTPS_PROXY=http://127.0.0.1:12334
set HTTP_PROXY=http://127.0.0.1:12334
set ALL_PROXY=http://127.0.0.1:12334

set SCRIPT_DIR=%~dp0
start "" "C:\WINDOWS\System32\wscript.exe" //B //Nologo "%SCRIPT_DIR%start_context_monitor.vbs"
start "" "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" --proxy-server=http://127.0.0.1:12334 --proxy-bypass-list=localhost;127.0.0.1;127.*;^<local^>
