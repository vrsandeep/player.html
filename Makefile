# Builds and runs the player from this checkout with docker-compose.dev.yml.
# Folders and port come from the compose file; override them per run, e.g.
#   make up VIDEO_DIR=~/Movies CONFIG_DIR=~/player-config

COMPOSE ?= docker compose -f docker-compose.dev.yml
URL ?= http://localhost:8080/
# Same pin as .github/workflows/ci.yml. The repo has no package.json, so the
# module lives in a gitignored prefix and is put on NODE_PATH for the suite.
PLAYWRIGHT_VERSION ?= 1.65.0
PLAYWRIGHT_DIR ?= .cache/playwright

export VIDEO_DIR AUDIO_DIR DOCUMENTS_DIR CONFIG_DIR AUTH_USERNAME AUTH_PASSWORD AUTH_HTPASSWD

.DEFAULT_GOAL := help
.PHONY: help build up down restart logs ps open test

help: ## Show available targets
	@awk 'BEGIN { FS = ":.*## " } /^[a-z-]+:.*## / { printf "  make %-8s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

up: ## Build the image and start the container in the background
	$(COMPOSE) up -d --build
	@echo "Player running at $(URL)"

down: ## Stop and remove the container
	$(COMPOSE) down

restart: down up ## Rebuild and restart the container

logs: ## Follow container logs
	$(COMPOSE) logs -f

ps: ## Show container status
	$(COMPOSE) ps

test: ## Run the browser tests
	@mkdir -p $(PLAYWRIGHT_DIR) .cache/bin
	@if command -v python >/dev/null 2>&1; then \
		rm -f .cache/bin/python; \
	else \
		printf '%s\n' '#!/bin/sh' 'exec python3 "$$@"' > .cache/bin/python; \
		chmod +x .cache/bin/python; \
	fi
	@if ! NODE_PATH=$(PLAYWRIGHT_DIR)/node_modules node -e "process.exit(require('playwright/package.json').version === '$(PLAYWRIGHT_VERSION)' ? 0 : 1)" >/dev/null 2>&1; then \
		npm install --prefix $(PLAYWRIGHT_DIR) --no-fund --no-audit playwright@$(PLAYWRIGHT_VERSION); \
		$(PLAYWRIGHT_DIR)/node_modules/.bin/playwright install chromium; \
	fi
	PATH="$(CURDIR)/.cache/bin:$$PATH" NODE_PATH=$(PLAYWRIGHT_DIR)/node_modules node --test tests/*.test.cjs
