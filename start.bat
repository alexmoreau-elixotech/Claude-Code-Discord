@echo off
echo.
echo  Claude Code Assistant
echo  =====================
echo.

:: Check Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo  Docker is not running. Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

echo  Starting services...
docker compose up -d --build

if errorlevel 1 (
    echo.
    echo  Failed to start. Check Docker Desktop is running.
    pause
    exit /b 1
)

echo.
echo  Claude Code Assistant is running!
echo  Opening http://localhost:3456 ...
echo.
timeout /t 3 >nul
start http://localhost:3456
echo  To stop: press Ctrl+C, then run: docker compose down
echo  Streaming logs...
echo.
docker compose logs -f
