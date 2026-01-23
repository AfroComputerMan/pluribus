# Makefile - Development Commands
.PHONY: dev prod build test clean logs shell db-migrate db-studio help

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
dev: ## Start development environment
	docker compose up -d
	docker compose logs -f pluribus

dev-all: ## Start dev environment with admin UIs (pgAdmin, Redis Commander)
	docker compose --profile dev-tools up -d
	docker compose logs -f pluribus

dev-build: ## Rebuild and start development environment
	docker compose build --no-cache
	docker compose up -d
	docker compose logs -f pluribus

stop: ## Stop all containers
	docker compose down

restart: ## Restart application container
	docker compose restart pluribus
	docker compose logs -f pluribus

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
test: ## Run tests
	docker compose exec pluribus bun test

test-watch: ## Run tests in watch mode
	docker compose exec pluribus bun test --watch

test-coverage: ## Run tests with coverage
	docker compose exec pluribus bun test --coverage

# ===================
# Utilities
# ===================
logs: ## Show all container logs
	docker compose logs -f

logs-app: ## Show application logs only
	docker compose logs -f pluribus

logs-db: ## Show database logs
	docker compose logs -f postgres

logs-redis: ## Show Redis logs
	docker compose logs -f redis

shell: ## Open shell in application container
	docker compose exec pluribus sh

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
install: ## Install dependencies locally
	bun install

local-dev: ## Run locally (requires local postgres/redis)
	bun run dev

local-build: ## Build locally
	bun run build

local-test: ## Run tests locally
	bun test

lint: ## Run linter
	bun run lint

lint-fix: ## Fix linting issues
	bun run lint:fix

format: ## Format code
	bun run format

typecheck: ## Run TypeScript type checking
	bun run typecheck
