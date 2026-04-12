#!/bin/bash
# Quick development setup script for Nachos
# This script helps developers get started quickly

set -e

echo "🧀 Nachos Development Setup"
echo "============================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first:"
    echo "   https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is available
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available. Please update Docker to a version with Compose v2"
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env and add your LLM API keys:"
    echo "   - ANTHROPIC_API_KEY for Claude"
    echo "   - OPENAI_API_KEY for GPT"
    echo ""
    echo "Press Enter to continue after editing .env, or Ctrl+C to exit..."
    read -r
fi

# Check if at least one API key is set
if ! grep -q "ANTHROPIC_API_KEY=sk-" .env && ! grep -q "OPENAI_API_KEY=sk-" .env; then
    echo "⚠️  Warning: No LLM API keys found in .env"
    echo "   The services will start but won't be able to make LLM requests"
    echo ""
fi

echo "🏗️  Building Docker images..."
docker compose -f docker-compose.dev.yml build

echo ""
echo "🚀 Starting services..."
docker compose -f docker-compose.dev.yml up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check service status
echo ""
docker compose -f docker-compose.dev.yml ps

echo ""
echo "============================"
echo "✅ Nachos development environment is ready!"
echo ""
echo "📊 View logs:          docker compose -f docker-compose.dev.yml logs -f"
echo "🔄 Restart services:   docker compose -f docker-compose.dev.yml restart"
echo "🛑 Stop services:      docker compose -f docker-compose.dev.yml down"
echo "🧪 Run tests:          ./docker/test-infrastructure.sh"
echo ""
echo "📝 Service URLs:"
echo "   - NATS Client:      nats://localhost:4222"
echo "   - NATS Monitoring:  http://localhost:8222"
echo "   - LLM Proxy:        http://localhost:3001"
echo ""
echo "💡 Tip: Any changes to .ts files will trigger automatic reload!"
echo ""
