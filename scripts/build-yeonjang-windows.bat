@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"
set "YEONJANG_DIR=%ROOT_DIR%\Yeonjang"
set "MANIFEST_PATH=%YEONJANG_DIR%\Cargo.toml"
set "BINARY_NAME=nobie-yeonjang.exe"
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

if /I not "%OS%"=="Windows_NT" (
  echo This script is Windows-only.
  exit /b 1
)

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

if not "%TARGET_TRIPLE%"=="" (
  set "BINARY_PATH=%TARGET_DIR%\%TARGET_TRIPLE%\%PROFILE%\%BINARY_NAME%"
) else (
  set "BINARY_PATH=%TARGET_DIR%\%PROFILE%\%BINARY_NAME%"
)

if not exist "%BINARY_PATH%" (
  echo Build finished, but the executable was not found: %BINARY_PATH%
  exit /b 1
)

echo Build complete:
echo   Binary : %BINARY_PATH%
echo   Target : %TARGET_DIR%
exit /b 0

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
