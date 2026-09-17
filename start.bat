@echo off
rem Call chcp by absolute path: on some setups PATH is incomplete and chcp
rem would not be found, leaving the console on codepage 936 which garbles
rem the UTF-8 Chinese output from the Node server.
set "CHCP_EXE=%SystemRoot%\System32\chcp.com"
if not exist "%CHCP_EXE%" set "CHCP_EXE=C:\Windows\System32\chcp.com"
if exist "%CHCP_EXE%" "%CHCP_EXE%" 65001 >nul
setlocal
cd /d "%~dp0"

rem ============================================================
rem  YT Script launcher
rem
rem  IMPORTANT: keep this file ASCII-only and CRLF line endings.
rem  cmd.exe mis-parses LF-only batch files, and multi-byte
rem  characters inside multi-line blocks break the parser.
rem  Do NOT use multi-line for( ) / if( ) blocks here.
rem ============================================================

set "NODE_EXE="

where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"

if not defined NODE_EXE goto no_node

echo   Starting YT Script ...
echo.

"%NODE_EXE%" server.js %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" echo   Server stopped.
if "%EXITCODE%"=="3" echo   An instance is already running - nothing to do.
if "%EXITCODE%"=="1" echo   [WARN] server exited with an error.
if "%EXITCODE%"=="2" echo   [WARN] server exited with an error.
echo.
echo   Press any key to close this window.
pause >nul

endlocal
exit /b %EXITCODE%

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
