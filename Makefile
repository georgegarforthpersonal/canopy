.PHONY: help dev dev-build staging staging-build prod prod-build down logs test-backend test-backend-build test-frontend test-frontend-build typecheck check build migrate migrate-staging migrate-prod shell modal-deploy

# Default environment
ENV ?= dev

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Environments:"
	@echo "  dev              Start development environment (local DB)"
	@echo "  dev-build        Start dev with rebuild"
	@echo "  staging          Start staging environment (Neon staging DB)"
	@echo "  staging-build    Start staging with rebuild"
	@echo "  prod             Start production environment (Neon prod DB)"
	@echo "  prod-build       Start prod with rebuild"
	@echo "  down             Stop all services"
	@echo "  logs             Tail logs from all services"
	@echo ""
	@echo "Development:"
	@echo "  build            Rebuild containers"
	@echo "  shell            Open bash in API container"
	@echo "  shell-staging    Open bash in staging scripts container"
	@echo "  shell-prod       Open bash in prod scripts container"
	@echo ""
	@echo "Database:"
	@echo "  migrate          Run migrations (dev)"
	@echo "  migrate-staging  Run migrations (staging)"
	@echo "  migrate-prod     Run migrations (prod)"
	@echo ""
	@echo "Inference:"
	@echo "  modal-deploy     Deploy the Modal inference app (see app/backend/modal_app/README.md)"
	@echo ""
	@echo "Testing:"
	@echo "  test-backend         Run backend pytest"
	@echo "  test-backend-build   Rebuild container and run backend pytest"
	@echo "  test-frontend        Run frontend vitest"
	@echo "  test-frontend-build  Reinstall deps and run frontend vitest"
	@echo "  typecheck            Run mypy type checking"
	@echo "  check                Run all tests (backend + frontend + typecheck)"

# =============================================================================
# Environments
# =============================================================================

dev:
	docker compose --profile dev up

dev-build:
	docker compose --profile dev up --build

staging:
	docker compose --profile staging up

staging-build:
	docker compose --profile staging up --build

prod:
	docker compose --profile prod up

prod-build:
	docker compose --profile prod up --build

down:
	docker compose --profile dev --profile staging --profile prod --profile test down

logs:
	docker compose logs -f

build:
	docker compose --profile dev build

# =============================================================================
# Development
# =============================================================================

shell:
	docker compose --profile dev run --rm scripts-dev bash

shell-staging:
	docker compose --profile staging run --rm scripts-staging bash

shell-prod:
	docker compose --profile prod run --rm scripts-prod bash

# =============================================================================
# Inference
# =============================================================================

modal-deploy:
	cd app/backend && modal deploy modal_app/canopy_inference.py

# =============================================================================
# Database Migrations
# =============================================================================

migrate:
	docker compose --profile dev run --rm scripts-dev bash -c "cd /app && PYTHONPATH=/app alembic upgrade head"

migrate-staging:
	docker compose --profile staging run --rm --build scripts-staging bash -c "cd /app && PYTHONPATH=/app alembic upgrade head"

migrate-prod:
	docker compose --profile prod run --rm --build scripts-prod bash -c "cd /app && PYTHONPATH=/app alembic upgrade head"

# =============================================================================
# Testing
# =============================================================================

test-backend:
	docker compose --profile test run --rm test

test-backend-build:
	docker compose --profile test build test && docker compose --profile test run --rm test

test-frontend:
	cd app/frontend && [ -d node_modules ] || npm install && npm run test:run

test-frontend-build:
	cd app/frontend && rm -rf node_modules && npm install && npm run test:run

typecheck:
	@docker run --rm -v "$(PWD)/app/backend:/app" -w /app python:3.11-slim \
		sh -c "pip install -q mypy types-requests pydantic-settings && mypy . --config-file mypy.ini"

check: typecheck test-backend test-frontend
