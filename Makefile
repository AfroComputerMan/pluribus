# Makefile - Development Commands
.PHONY: dev dev-backend dev-frontend dev-all dev-build stop restart restart-backend restart-frontend \
        prod prod-down build build-prod \
        db-migrate db-generate db-push db-studio db-seed db-reset \
        test test-unit test-integration test-migrations test-watch test-coverage \
        logs logs-app logs-frontend logs-db logs-redis shell shell-frontend psql redis-cli \
        clean clean-all prune health status \
        install local-dev local-build local-test lint lint-fix format typecheck \
        frontend-install frontend-dev frontend-build frontend-lint frontend-preview \
        help

# Default target
.DEFAULT_GOAL := help

# Colors
CYAN := \033[0;36m
GREEN := \033[0;32m
YELLOW := \033[0;33m
NC := \033[0m # No Color

help: ## Show this help
	@echo "$(CYAN)Pluribus - Agent Organization System$(NC)"
	@echo ""
	@echo "$(GREEN)Available commands:$(NC)"
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  $(CYAN)%-15s$(NC) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ===================
# Development
# ===================
dev: ## Start development environment (backend + frontend)
	docker compose up -d pluribus frontend
	@echo "$(GREEN)Backend:$(NC)  http://localhost:3000"
	@echo "$(GREEN)Frontend:$(NC) http://localhost:5173"
	docker compose logs -f pluribus frontend

dev-backend: ## Start backend only
	docker compose up -d pluribus
	docker compose logs -f pluribus

dev-frontend: ## Start frontend only (requires backend running)
	docker compose up -d frontend
	docker compose logs -f frontend

dev-all: ## Start full dev environment with admin UIs (pgAdmin, Redis Commander)
	docker compose --profile dev-tools up -d
	@echo "$(GREEN)Backend:$(NC)        http://localhost:3000"
	@echo "$(GREEN)Frontend:$(NC)       http://localhost:5173"
	@echo "$(GREEN)Redis Commander:$(NC) http://localhost:8081"
	@echo "$(GREEN)pgAdmin:$(NC)        http://localhost:8082"
	docker compose logs -f pluribus frontend

dev-build: ## Rebuild and start development environment
	docker compose build --no-cache pluribus frontend
	docker compose up -d pluribus frontend
	docker compose logs -f pluribus frontend

stop: ## Stop all containers
	docker compose down

restart: ## Restart application containers
	docker compose restart pluribus frontend
	docker compose logs -f pluribus frontend

restart-backend: ## Restart backend container only
	docker compose restart pluribus
	docker compose logs -f pluribus

restart-frontend: ## Restart frontend container only
	docker compose restart frontend
	docker compose logs -f frontend

# ===================
# Production
# ===================
prod: ## Start production environment
	docker compose -f docker-compose.prod.yml up -d

prod-down: ## Stop production environment
	docker compose -f docker-compose.prod.yml down

# ===================
# Build
# ===================
build: ## Build Docker images
	docker compose build --no-cache

build-prod: ## Build production Docker image
	docker build -t pluribus:latest .

# ===================
# Database
# ===================
db-migrate: ## Run database migrations
	docker compose exec pluribus bun run db:migrate

db-generate: ## Generate migrations from schema changes
	docker compose exec pluribus bun run db:generate

db-push: ## Push schema changes directly (dev only)
	docker compose exec pluribus bun run db:push

db-studio: ## Open Drizzle Studio
	docker compose exec pluribus bun run db:studio

db-seed: ## Seed database with sample data
	docker compose exec pluribus bun run db:seed

db-reset: ## Reset database (WARNING: destroys all data)
	docker compose down postgres -v
	docker compose up -d postgres
	@echo "$(YELLOW)Waiting for postgres to start...$(NC)"
	@sleep 5
	$(MAKE) db-migrate

# ===================
# Testing
# ===================
test: ## Run all tests
	docker compose exec pluribus bun test

test-unit: ## Run unit tests only
	docker compose exec pluribus bun test tests/unit

test-integration: ## Run integration tests (requires Docker)
	bun test tests/integration --timeout 120000

test-migrations: ## Run migration tests (uses testcontainers)
	bun test tests/integration/db/migrations.test.ts --timeout 120000

test-watch: ## Run tests in watch mode
	docker compose exec pluribus bun test --watch

test-coverage: ## Run tests with coverage
	docker compose exec pluribus bun test --coverage

# ===================
# Utilities
# ===================
logs: ## Show all container logs
	docker compose logs -f

logs-app: ## Show backend logs only
	docker compose logs -f pluribus

logs-frontend: ## Show frontend logs only
	docker compose logs -f frontend

logs-db: ## Show database logs
	docker compose logs -f postgres

logs-redis: ## Show Redis logs
	docker compose logs -f redis

shell: ## Open shell in backend container
	docker compose exec pluribus sh

shell-frontend: ## Open shell in frontend container
	docker compose exec frontend sh

psql: ## Open PostgreSQL shell
	docker compose exec postgres psql -U pluribus -d pluribus

redis-cli: ## Open Redis CLI
	docker compose exec redis redis-cli

# ===================
# Cleanup
# ===================
clean: ## Stop containers and remove volumes
	docker compose down -v --remove-orphans

clean-all: ## Full cleanup including images
	docker compose down -v --remove-orphans --rmi all

prune: ## Prune unused Docker resources
	docker system prune -f

# ===================
# Health & Status
# ===================
health: ## Check service health
	@echo "$(CYAN)Checking services...$(NC)"
	@docker compose ps
	@echo ""
	@echo "$(GREEN)Postgres:$(NC)"
	@docker compose exec postgres pg_isready -U pluribus || true
	@echo ""
	@echo "$(GREEN)Redis:$(NC)"
	@docker compose exec redis redis-cli ping || true
	@echo ""
	@echo "$(GREEN)Application:$(NC)"
	@curl -sf http://localhost:3000/health && echo " OK" || echo " Not responding"

status: ## Show container status
	docker compose ps

# ===================
# Local Development (without Docker)
# ===================
install: ## Install dependencies locally (backend + frontend)
	bun install
	cd frontend && bun install

local-dev: ## Run backend locally (requires local postgres/redis)
	bun run dev

local-build: ## Build backend locally
	bun run build

local-test: ## Run tests locally
	bun test

lint: ## Run linter (backend)
	bun run lint

lint-fix: ## Fix linting issues (backend)
	bun run lint:fix

format: ## Format code (backend)
	bun run format

typecheck: ## Run TypeScript type checking (backend)
	bun run typecheck

# ===================
# Frontend Local Development
# ===================
frontend-install: ## Install frontend dependencies
	cd frontend && bun install

frontend-dev: ## Run frontend locally
	cd frontend && bun run dev

frontend-build: ## Build frontend for production
	cd frontend && bun run build

frontend-lint: ## Run frontend linter
	cd frontend && bun run lint

frontend-preview: ## Preview frontend production build
	cd frontend && bun run preview
