@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"
set "PID_FILE=%ROOT_DIR%\pids\yeonjang-windows.pid"

if not exist "%PID_FILE%" (
  echo No Yeonjang PID file was found.
  exit /b 0
)

set /p PID=<"%PID_FILE%"

if "%PID%"=="" (
  del /f /q "%PID_FILE%" >nul 2>nul
  echo The Yeonjang PID file was empty and has been removed.
  exit /b 0
)

tasklist /FI "PID eq %PID%" | find "%PID%" >nul
if errorlevel 1 (
  del /f /q "%PID_FILE%" >nul 2>nul
  echo The Yeonjang process was already stopped. Removed the stale PID file.
  exit /b 0
)

echo Stopping the Yeonjang GUI... PID=%PID%
taskkill /PID %PID% >nul 2>nul

for /L %%I in (1,1,20) do (
  tasklist /FI "PID eq %PID%" | find "%PID%" >nul
  if errorlevel 1 (
    del /f /q "%PID_FILE%" >nul 2>nul
    echo Yeonjang GUI stopped
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)

echo The Yeonjang GUI is still running, forcing termination.
taskkill /F /T /PID %PID% >nul 2>nul
del /f /q "%PID_FILE%" >nul 2>nul
echo Yeonjang GUI force-stopped
exit /b 0
