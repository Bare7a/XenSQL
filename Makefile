# XenSQL developer tasks.
#
# Unit tests (embedded SQLite only, no servers needed):
#   make test
#
# End-to-end tests against real PostgreSQL, MySQL and MariaDB:
#   make e2e-all          # bring the stack up, run the suite, tear it down
# or, to keep the stack running between runs:
#   make e2e-up
#   make e2e
#   make e2e-down
#
# Override the compose command for Podman:
#   make e2e-all COMPOSE="podman compose"

COMPOSE ?= docker compose

# Extra build tags. On Linux, building the (Wails-linked) main package needs the
# webview tag, matching the release workflow: make test BUILD_TAGS=webkit2_41
BUILD_TAGS ?=

.PHONY: test e2e e2e-up e2e-down e2e-logs e2e-all

# Fast unit tests - no database servers required.
test:
	go test -tags "$(BUILD_TAGS)" ./...

# Bring up the database stack and block until every server is healthy.
e2e-up:
	$(COMPOSE) up -d --wait

# Tear the stack down and discard its volumes.
e2e-down:
	$(COMPOSE) down -v

e2e-logs:
	$(COMPOSE) logs --no-color

# Run the E2E suite against an already-running stack (see e2e-up).
# Connection details come from the environment; the defaults match docker-compose.yml.
e2e:
	go test -tags "e2e $(BUILD_TAGS)" -count=1 -run TestE2E -v ./internal/app/

# One-shot: up -> test -> down. Always tears down, and fails if the suite failed.
e2e-all:
	$(COMPOSE) up -d --wait
	@status=0; \
	$(MAKE) e2e || status=$$?; \
	$(COMPOSE) down -v; \
	exit $$status
