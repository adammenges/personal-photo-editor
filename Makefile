.DEFAULT_GOAL := help

.PHONY: help setup doctor dev check visual-test icons build-app clean

help:
	@echo "Grainlab development commands"
	@echo ""
	@echo "  make setup      Install pinned tools and fetch dependencies"
	@echo "  make doctor     Check the local development environment"
	@echo "  make dev        Launch Grainlab with hot reload"
	@echo "  make check      Run syntax checks, formatting, Clippy, and tests"
	@echo "  make visual-test Fetch fixtures, measure baselines, and build the visual report"
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

icons:
	swift scripts/validate_app_icon.swift assets/icons/AppIcon-1024.png
	cargo tauri icon assets/icons/AppIcon-1024.png

build-app:
	./scripts/build_macos_app.sh

clean:
	cargo clean
	rm -rf dist src-tauri/target
