@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"
set "PIDS_DIR=%ROOT_DIR%\pids"
set "LOGS_DIR=%ROOT_DIR%\logs"
set "PID_FILE=%PIDS_DIR%\yeonjang-windows.pid"
set "LOG_FILE=%LOGS_DIR%\yeonjang-windows.log"
set "BINARY_NAME=nobie-yeonjang.exe"
set "REPO_TARGET_DIR=%ROOT_DIR%\Yeonjang\target"

if "%YEONJANG_PROFILE%"=="" (
  set "PROFILE=release"
) else (
  set "PROFILE=%YEONJANG_PROFILE%"
)

set "TARGET_TRIPLE=%YEONJANG_TARGET_TRIPLE%"
if "%YEONJANG_TARGET_DIR%"=="" (
  set "TARGET_DIR=%LOCALAPPDATA%\Yeonjang\target"
) else (
  set "TARGET_DIR=%YEONJANG_TARGET_DIR%"
)
set "FALLBACK_TARGET_DIR=%SystemRoot%\System32\config\systemprofile\AppData\Local\Yeonjang\target"
if /I "%PROFILE%"=="release" (
  set "ALT_PROFILE=debug"
) else (
  set "ALT_PROFILE=release"
)

if /I not "%OS%"=="Windows_NT" (
  echo This script is Windows-only.
  exit /b 1
)

if not exist "%PIDS_DIR%" mkdir "%PIDS_DIR%"
if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"

call :resolve_binary_path

if not exist "%BINARY_PATH%" (
  call "%SCRIPT_DIR%build-yeonjang-windows.bat"
  if errorlevel 1 exit /b 1
  call :resolve_binary_path
)

if not exist "%BINARY_PATH%" (
  echo Yeonjang executable was not found: %BINARY_PATH%
  exit /b 1
)

call :stop_existing
break > "%LOG_FILE%"

echo Starting the Yeonjang GUI...
for /f %%P in ('powershell -NoProfile -Command "$p = Start-Process -FilePath \"%BINARY_PATH%\" -WindowStyle Hidden -PassThru; $p.Id"') do (
  set "STARTED_PID=%%P"
)

if "%STARTED_PID%"=="" (
  echo Failed to start the Yeonjang GUI.
  exit /b 1
)

> "%PID_FILE%" echo %STARTED_PID%
timeout /t 2 /nobreak >nul

call :process_exists %STARTED_PID%
if errorlevel 1 (
  echo The Yeonjang GUI exited during startup.
  del /f /q "%PID_FILE%" >nul 2>nul
  exit /b 1
)

echo Yeonjang GUI started
echo   PID  : %STARTED_PID%
echo   Log  : %LOG_FILE%
echo   Target : %TARGET_DIR%
echo   Stop : scripts\stop-yeonjang-windows.bat
exit /b 0

:resolve_binary_path
set "BINARY_PATH="
if not "%TARGET_TRIPLE%"=="" (
  if exist "%TARGET_DIR%\%TARGET_TRIPLE%\%PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%TARGET_DIR%\%TARGET_TRIPLE%\%PROFILE%\%BINARY_NAME%"
  if "%BINARY_PATH%"=="" if exist "%REPO_TARGET_DIR%\%TARGET_TRIPLE%\%PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%REPO_TARGET_DIR%\%TARGET_TRIPLE%\%PROFILE%\%BINARY_NAME%"
  if "%BINARY_PATH%"=="" if exist "%FALLBACK_TARGET_DIR%\%TARGET_TRIPLE%\%PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%FALLBACK_TARGET_DIR%\%TARGET_TRIPLE%\%PROFILE%\%BINARY_NAME%"
  if "%BINARY_PATH%"=="" if exist "%TARGET_DIR%\%TARGET_TRIPLE%\%ALT_PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%TARGET_DIR%\%TARGET_TRIPLE%\%ALT_PROFILE%\%BINARY_NAME%"
  if "%BINARY_PATH%"=="" if exist "%REPO_TARGET_DIR%\%TARGET_TRIPLE%\%ALT_PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%REPO_TARGET_DIR%\%TARGET_TRIPLE%\%ALT_PROFILE%\%BINARY_NAME%"
  if "%BINARY_PATH%"=="" if exist "%FALLBACK_TARGET_DIR%\%TARGET_TRIPLE%\%ALT_PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%FALLBACK_TARGET_DIR%\%TARGET_TRIPLE%\%ALT_PROFILE%\%BINARY_NAME%"
) else (
  if exist "%TARGET_DIR%\%PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%TARGET_DIR%\%PROFILE%\%BINARY_NAME%"
  if "%BINARY_PATH%"=="" if exist "%REPO_TARGET_DIR%\%PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%REPO_TARGET_DIR%\%PROFILE%\%BINARY_NAME%"
  if "%BINARY_PATH%"=="" if exist "%FALLBACK_TARGET_DIR%\%PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%FALLBACK_TARGET_DIR%\%PROFILE%\%BINARY_NAME%"
  if "%BINARY_PATH%"=="" if exist "%TARGET_DIR%\%ALT_PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%TARGET_DIR%\%ALT_PROFILE%\%BINARY_NAME%"
  if "%BINARY_PATH%"=="" if exist "%REPO_TARGET_DIR%\%ALT_PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%REPO_TARGET_DIR%\%ALT_PROFILE%\%BINARY_NAME%"
  if "%BINARY_PATH%"=="" if exist "%FALLBACK_TARGET_DIR%\%ALT_PROFILE%\%BINARY_NAME%" set "BINARY_PATH=%FALLBACK_TARGET_DIR%\%ALT_PROFILE%\%BINARY_NAME%"
)
if "%BINARY_PATH%"=="" (
  if not "%TARGET_TRIPLE%"=="" (
    set "BINARY_PATH=%TARGET_DIR%\%TARGET_TRIPLE%\%PROFILE%\%BINARY_NAME%"
  ) else (
    set "BINARY_PATH=%TARGET_DIR%\%PROFILE%\%BINARY_NAME%"
  )
)
goto :eof

:stop_existing
if not exist "%PID_FILE%" goto :eof

set /p EXISTING_PID=<"%PID_FILE%"
if "%EXISTING_PID%"=="" (
  del /f /q "%PID_FILE%" >nul 2>nul
  goto :eof
)

call :process_exists %EXISTING_PID%
if errorlevel 1 (
  del /f /q "%PID_FILE%" >nul 2>nul
  goto :eof
)

echo Stopping the existing Yeonjang GUI. PID=%EXISTING_PID%
taskkill /PID %EXISTING_PID% >nul 2>nul

for /L %%I in (1,1,20) do (
  call :process_exists %EXISTING_PID%
  if errorlevel 1 (
    del /f /q "%PID_FILE%" >nul 2>nul
    goto :eof
  )
  timeout /t 1 /nobreak >nul
)

echo The existing Yeonjang GUI is still running, forcing termination.
taskkill /F /T /PID %EXISTING_PID% >nul 2>nul
del /f /q "%PID_FILE%" >nul 2>nul
goto :eof

:process_exists
powershell -NoProfile -Command "if (Get-Process -Id %1 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
exit /b %errorlevel%
