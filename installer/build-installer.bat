@echo off
:: ==========================================================================
:: Build the Claude Code Assistant NSIS installer
:: Requires: NSIS installed and makensis on PATH
:: ==========================================================================

echo.
echo  Building Claude Code Assistant Installer...
echo  ============================================
echo.

:: Check that makensis is available
where makensis >nul 2>&1
if errorlevel 1 (
    echo  ERROR: makensis not found on PATH.
    echo  Please install NSIS from https://nsis.sourceforge.io/
    echo.
    pause
    exit /b 1
)

:: Build the installer from the installer directory
pushd "%~dp0"
makensis installer.nsi
if errorlevel 1 (
    echo.
    echo  ERROR: Installer build failed.
    popd
    pause
    exit /b 1
)
popd

echo.
echo  Installer built successfully!
echo  Output: installer\ClaudeCodeAssistant-Setup.exe
echo.
pause
