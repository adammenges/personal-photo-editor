.DEFAULT_GOAL := help

.PHONY: help setup doctor dev check visual-test learn-style icons build-app clean

help:
	@echo "Grainlab development commands"
	@echo ""
	@echo "  make setup      Install pinned tools and fetch dependencies"
	@echo "  make doctor     Check the local development environment"
	@echo "  make dev        Launch Grainlab with hot reload"
	@echo "  make check      Run syntax checks, formatting, Clippy, and tests"
	@echo "  make visual-test Fetch fixtures, measure baselines, and build the visual report"
	@echo "  make learn-style Analyze and install a personal film-scan style (INPUT=... ID=...)"
	@echo "  make icons      Regenerate platform icons from the source PNG"
	@echo "  make build-app  Build and verify a release .app in dist/"
	@echo "  make clean      Remove generated build output"

setup:
	./scripts/setup.sh

doctor:
	./scripts/doctor.sh

dev:
	./scripts/dev.sh

check:
	./scripts/check.sh

visual-test:
	./scripts/run_visual_tests.sh

learn-style:
	@test -n "$(INPUT)" || (echo "usage: make learn-style INPUT=/path/to/scan-or-roll ID=my-roll-style NAME='My Roll Style'" >&2; exit 2)
	@test -n "$(ID)" || (echo "usage: make learn-style INPUT=/path/to/scan-or-roll ID=my-roll-style NAME='My Roll Style'" >&2; exit 2)
	./scripts/learn_film_style.sh --input "$(INPUT)" --id "$(ID)" $(if $(strip $(NAME)),--name "$(NAME)",) --install
	@RUSTUP_BIN_DIR="$$(dirname -- "$$(command -v rustup 2>/dev/null || true)")"; \
	if [ -n "$$RUSTUP_BIN_DIR" ] && [ -x "$$RUSTUP_BIN_DIR/cargo" ]; then PATH="$$RUSTUP_BIN_DIR:$$PATH"; fi; \
	cargo check --manifest-path src-tauri/Cargo.toml --locked

icons:
	swift scripts/validate_app_icon.swift assets/icons/AppIcon-1024.png
	cargo tauri icon assets/icons/AppIcon-1024.png

build-app:
	./scripts/build_macos_app.sh

clean:
	cargo clean
	rm -rf dist src-tauri/target
