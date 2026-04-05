@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"
set "YEONJANG_DIR=%ROOT_DIR%\Yeonjang"
set "MANIFEST_PATH=%YEONJANG_DIR%\Cargo.toml"
set "BINARY_NAME=nobie-yeonjang.exe"
set "PIDS_DIR=%ROOT_DIR%\pids"
set "LOGS_DIR=%ROOT_DIR%\logs"
set "PID_FILE=%PIDS_DIR%\yeonjang-windows.pid"
set "LOG_FILE=%LOGS_DIR%\yeonjang-windows.log"
set "REPO_TARGET_DIR=%ROOT_DIR%\Yeonjang\target"
set "CARGO_EXE="
set "SYSTEM_CARGO=C:\Windows\System32\config\systemprofile\.cargo\bin\cargo.exe"
set "SYSTEM_TOOLCHAIN_CARGO=C:\Windows\System32\config\systemprofile\.rustup\toolchains\stable-aarch64-pc-windows-msvc\bin\cargo.exe"
set "SYSTEM_PROFILE=C:\Windows\System32\config\systemprofile"
set "SYSTEM_CARGO_HOME=%SYSTEM_PROFILE%\.cargo"
set "SYSTEM_RUSTUP_HOME=%SYSTEM_PROFILE%\.rustup"

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

if not "%YEONJANG_CARGO_EXE%"=="" call :try_cargo "%YEONJANG_CARGO_EXE%"
if "%CARGO_EXE%"=="" call :try_cargo "cargo"
if "%CARGO_EXE%"=="" call :try_cargo "%USERPROFILE%\.cargo\bin\cargo.exe"
if "%CARGO_EXE%"=="" call :try_cargo "%HOMEDRIVE%%HOMEPATH%\.cargo\bin\cargo.exe"
if "%CARGO_EXE%"=="" call :try_cargo "%SYSTEM_CARGO%"
if "%CARGO_EXE%"=="" call :try_cargo "%SYSTEM_TOOLCHAIN_CARGO%"
if "%CARGO_EXE%"=="" (
  for /d %%D in ("%USERPROFILE%\.rustup\toolchains\*") do (
    if "%CARGO_EXE%"=="" call :try_cargo "%%~fD\bin\cargo.exe"
  )
)
if "%CARGO_EXE%"=="" (
  for /d %%D in ("%SystemRoot%\System32\config\systemprofile\.rustup\toolchains\*") do (
    if "%CARGO_EXE%"=="" call :try_cargo "%%~fD\bin\cargo.exe"
  )
)
if "%CARGO_EXE%"=="" (
  for /d %%D in ("%SystemDrive%\Users\*") do (
    if "%CARGO_EXE%"=="" call :try_cargo "%%~fD\.cargo\bin\cargo.exe"
  )
)
if "%CARGO_EXE%"=="" (
  for /d %%U in ("%SystemDrive%\Users\*") do (
    for /d %%T in ("%%~fU\.rustup\toolchains\*") do (
      if "%CARGO_EXE%"=="" call :try_cargo "%%~fT\bin\cargo.exe"
    )
  )
)
if "%CARGO_EXE%"=="" (
  echo cargo was not found. Install the Rust toolchain first or add cargo to PATH.
  echo Checked:
  if not "%YEONJANG_CARGO_EXE%"=="" echo   YEONJANG_CARGO_EXE=%YEONJANG_CARGO_EXE%
  echo   PATH lookup
  echo   %USERPROFILE%\.cargo\bin\cargo.exe
  echo   %HOMEDRIVE%%HOMEPATH%\.cargo\bin\cargo.exe
  echo   %SYSTEM_CARGO%
  echo   %SYSTEM_TOOLCHAIN_CARGO%
  echo   %USERPROFILE%\.rustup\toolchains\*\bin\cargo.exe
  echo   %SystemRoot%\System32\config\systemprofile\.rustup\toolchains\*\bin\cargo.exe
  exit /b 1
)

if not exist "%MANIFEST_PATH%" (
  echo Yeonjang Cargo.toml was not found: %MANIFEST_PATH%
  exit /b 1
)

if /I "%CARGO_EXE%"=="%SYSTEM_CARGO%" call :use_system_profile_env
if /I "%CARGO_EXE%"=="%SYSTEM_TOOLCHAIN_CARGO%" call :use_system_profile_env

call :stop_existing

echo Building Yeonjang for Windows...
echo   Cargo  : %CARGO_EXE%
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
set "CARGO_TARGET_DIR=%TARGET_DIR%"
if exist "C:\Program Files\LLVM\bin\clang.exe" (
  set "PATH=C:\Program Files\LLVM\bin;%PATH%"
  set "CC=C:\Program Files\LLVM\bin\clang.exe"
  set "CXX=C:\Program Files\LLVM\bin\clang++.exe"
)
if /I "%PROFILE%"=="release" (
  if not "%TARGET_TRIPLE%"=="" (
    "%CARGO_EXE%" build --manifest-path "%MANIFEST_PATH%" --release --target %TARGET_TRIPLE%
  ) else (
    "%CARGO_EXE%" build --manifest-path "%MANIFEST_PATH%" --release
  )
) else (
  if not "%TARGET_TRIPLE%"=="" (
    "%CARGO_EXE%" build --manifest-path "%MANIFEST_PATH%" --target %TARGET_TRIPLE%
  ) else (
    "%CARGO_EXE%" build --manifest-path "%MANIFEST_PATH%"
  )
)
if errorlevel 1 exit /b 1

call :resolve_binary_path
if not exist "%BINARY_PATH%" (
  echo Build finished, but the executable was not found: %BINARY_PATH%
  exit /b 1
)

echo Build complete:
echo   Binary : %BINARY_PATH%
echo   Target : %TARGET_DIR%

if /I "%YEONJANG_BUILD_ONLY%"=="1" exit /b 0

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

set "EXISTING_PID="
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

:use_system_profile_env
set "USERPROFILE=%SYSTEM_PROFILE%"
set "CARGO_HOME=%SYSTEM_CARGO_HOME%"
set "RUSTUP_HOME=%SYSTEM_RUSTUP_HOME%"
goto :eof

:try_cargo
if not "%CARGO_EXE%"=="" goto :eof
set "CANDIDATE=%~1"
if "%CANDIDATE%"=="" goto :eof
set "ORIG_USERPROFILE=%USERPROFILE%"
set "ORIG_CARGO_HOME=%CARGO_HOME%"
set "ORIG_RUSTUP_HOME=%RUSTUP_HOME%"
if /I "%CANDIDATE%"=="%SYSTEM_CARGO%" call :use_system_profile_env
if /I "%CANDIDATE%"=="%SYSTEM_TOOLCHAIN_CARGO%" call :use_system_profile_env
"%CANDIDATE%" --version >nul 2>nul
if not errorlevel 1 set "CARGO_EXE=%CANDIDATE%"
set "USERPROFILE=%ORIG_USERPROFILE%"
set "CARGO_HOME=%ORIG_CARGO_HOME%"
set "RUSTUP_HOME=%ORIG_RUSTUP_HOME%"
goto :eof
