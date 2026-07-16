.PHONY: setup dev check build-app clean

setup:
	./scripts/setup.sh

dev:
	./scripts/dev.sh

check:
	./scripts/check.sh

build-app:
	./scripts/build_macos_app.sh

clean:
	cargo clean
	rm -rf dist src-tauri/target
