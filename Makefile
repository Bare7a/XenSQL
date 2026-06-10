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

# Extra build tags (usually none). Wails v3 links WebKitGTK 4.1 on Linux without a
# build tag - just install the dev libraries (libgtk-3-dev libwebkit2gtk-4.1-dev).
BUILD_TAGS ?=

.PHONY: test build-check e2e e2e-up e2e-down e2e-logs e2e-all

# Fast unit tests - no database servers required.
test:
	go test -tags "$(BUILD_TAGS)" ./internal/...

# Compile the app: the Wails entry point (.) and the internal packages. Stubs
# frontend/dist so the //go:embed resolves without a full frontend build (real
# assets come from `wails3 task build`). build/ios and build/android hold mobile
# entry points that only compile under their own targets, so they're excluded here.
build-check:
	@mkdir -p frontend/dist && touch frontend/dist/.gitkeep
	go build -tags "$(BUILD_TAGS)" . ./internal/...

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
