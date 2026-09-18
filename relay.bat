@echo off
rem ============================================================
rem  YT Script - local relay launcher
rem
rem  Purpose: let the deployed site use YOUR OWN computer as the
rem  egress to YouTube. Vercel's shared data center IP gets
rem  bot-checked by YouTube for many videos; a home network
rem  does not.
rem
rem  This script only does three things:
rem    1. locate node
rem    2. print the relay token (needed by the Vercel env var)
rem    3. start the local service + a public tunnel
rem
rem  Everything about the tunnel (which program, the public URL,
rem  clipboard, self-check) lives in lib\relay-tunnel.js, because
rem  parsing a child process output in batch is fragile.
rem
rem  IMPORTANT: keep this file ASCII-only with CRLF line endings.
rem  cmd.exe mis-parses LF-only batch files, and multi-byte chars
rem  break the parser. Do NOT use multi-line for( ) / if( ) blocks.
rem ============================================================

set "CHCP_EXE=%SystemRoot%\System32\chcp.com"
if not exist "%CHCP_EXE%" set "CHCP_EXE=C:\Windows\System32\chcp.com"
if exist "%CHCP_EXE%" "%CHCP_EXE%" 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   YT Script - local relay
echo ============================================================
echo.

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
if not defined NODE_EXE goto no_node

rem Read/create the relay token.
rem NOTE: do NOT try to capture node output with for /f here.
rem When NODE_EXE is a quoted path containing a space
rem ("C:\Program Files\nodejs\node.exe"), cmd /c strips the outer
rem quotes and fails with: 'C:\Program' is not recognized.
rem Writing to a temp file and using set /p avoids that entirely.
set "TOKEN_FILE=%TEMP%\ytscript-relay-token.txt"
set "RELAY_TOKEN="
"%NODE_EXE%" -e "console.log(require('./lib/config').ensureRelayToken())" >"%TOKEN_FILE%" 2>nul
if exist "%TOKEN_FILE%" set /p RELAY_TOKEN=<"%TOKEN_FILE%"
if exist "%TOKEN_FILE%" del "%TOKEN_FILE%" >nul 2>nul
if not defined RELAY_TOKEN goto no_token

set "RELAY_PORT=8801"

echo   Step 1 of 2 - your relay token
echo.
echo       RELAY_TOKEN = %RELAY_TOKEN%
echo.
echo   This value never changes. You will need it for the
echo   Vercel environment variable step described below.
echo.

echo   Step 2 of 2 - starting the local service on port %RELAY_PORT% ...
rem Use "start /b" so the service shares this window.
rem Do NOT use "start /min": it needs to create a brand new console and
rem silently does nothing in some environments, leaving the tunnel
rem pointing at a dead port. With /b one Ctrl+C stops both processes.
start /b "" "%NODE_EXE%" server.js --relay --port %RELAY_PORT% --no-open

rem Let the service print its banner before the tunnel starts.
rem (ping, not timeout: timeout fails when stdin is redirected)
"%SystemRoot%\System32\ping.exe" -n 3 127.0.0.1 >nul

"%NODE_EXE%" lib\relay-tunnel.js --port %RELAY_PORT%

echo.
echo   The relay has stopped. The site falls back to the cloud
echo   direct path - it still works, but YouTube will bot-check
echo   some videos again.
echo.
echo   Press any key to close this window.
pause >nul

endlocal
exit /b 0

:no_node
echo.
echo   [ERROR] Node.js not found on this computer.
echo   This tool needs Node.js 18 or newer.
echo   Download: https://nodejs.org
echo.
echo   Press any key to close this window.
pause >nul
endlocal
exit /b 1

:no_token
echo   [ERROR] Could not read or create the relay token.
echo.
echo   Run this first and paste the printed value into Vercel:
echo       "%NODE_EXE%" -e "console.log(require('./lib/config').ensureRelayToken())"
echo.
echo   Press any key to close this window.
pause >nul
endlocal
exit /b 1
