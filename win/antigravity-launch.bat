@echo off
setlocal
if not defined ANTIGRAVITY_EXE set "ANTIGRAVITY_EXE=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
if not exist "%ANTIGRAVITY_EXE%" (
  echo Antigravity executable not found. Set ANTIGRAVITY_EXE to its absolute path.
  pause
  exit /b 1
)
for %%i in (node.exe) do set "NODE_EXE=%%~$PATH:i"
if not defined NODE_EXE set "NODE_EXE=node"
"%NODE_EXE%" -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)" >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  pause
  exit /b 1
)
start "" "%ANTIGRAVITY_EXE%"
start "" "%SystemRoot%\System32\wscript.exe" //B //Nologo "%~dp0start_context_monitor.vbs"
