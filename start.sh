#!/bin/bash
echo ""
echo "  Claude Code Assistant"
echo "  ====================="
echo ""

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "  Docker is not running. Please start Docker Desktop and try again."
    exit 1
fi

echo "  Starting services..."
docker compose up -d --build

if [ $? -ne 0 ]; then
    echo ""
    echo "  Failed to start. Check Docker Desktop is running."
    exit 1
fi

echo ""
echo "  Claude Code Assistant is running!"
echo "  Opening http://localhost:3456 ..."
echo ""
sleep 3
open http://localhost:3456 2>/dev/null || xdg-open http://localhost:3456 2>/dev/null || echo "  Open http://localhost:3456 in your browser."
echo ""
echo "  To stop: docker compose down"
