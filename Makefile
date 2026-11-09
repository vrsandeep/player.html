# Builds and runs the player from this checkout with docker-compose.dev.yml.
# Folders and port come from the compose file; override them per run, e.g.
#   make up VIDEO_DIR=~/Movies CONFIG_DIR=~/player-config

COMPOSE ?= docker compose -f docker-compose.dev.yml
URL ?= http://localhost:8080/

export VIDEO_DIR AUDIO_DIR PDF_DIR CONFIG_DIR

.DEFAULT_GOAL := help
.PHONY: help build up down restart logs ps open

help: ## Show available targets
	@awk 'BEGIN { FS = ":.*## " } /^[a-z-]+:.*## / { printf "  make %-8s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

build: ## Build the image
	$(COMPOSE) build

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

open: ## Open the player in the browser
	$(shell command -v open || command -v xdg-open) $(URL)
