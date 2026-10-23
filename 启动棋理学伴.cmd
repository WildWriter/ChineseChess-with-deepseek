@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "QILI_NODE=node"
where node >nul 2>&1
if errorlevel 1 (
    if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
        set "QILI_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    ) else (
        echo Please install Node.js 22.9 or newer, then run this launcher again.
        pause
        exit /b 1
    )
)
if not exist "engine\pikafish.nnue" (
    "%QILI_NODE%" scripts/prepare-engine.js
    if errorlevel 1 echo Engine unavailable. Rules training and lessons can still be used.
)
echo Open the Local URL below. Press Ctrl+C to stop the server.
"%QILI_NODE%" --env-file-if-exists=.env server.js
if errorlevel 1 echo Startup failed. Check the error above and use Node.js 22.9 or newer.
pause
