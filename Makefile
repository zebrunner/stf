# Project checks (ZEBRUNNER.md#development): `make check` runs the Lint and the Unit tests jobs of CI over the npm
# scripts; node_modules is installed by `npm ci` first when it is missing or package-lock.json changed
SHELL := /bin/bash

# The image of the STF of MCloud (ZEBRUNNER.md#build): `make build VERSION=<tag>` in the local docker, `make push
# VERSION=<tag>` builds PLATFORMS with docker buildx and pushes them (docker login public.ecr.aws first)
IMAGE_REPO ?= public.ecr.aws/zebrunner/stf
VERSION ?= dev
PLATFORMS ?= linux/amd64,linux/arm64

.DEFAULT_GOAL := help
.PHONY: help check lint test build push

help: ## this list
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/'

check: ## lint and test, as CI runs them; every one runs, the failed ones fail the target
	@status=0; for target in lint test; do $(MAKE) --no-print-directory $$target || status=1; done; exit $$status

lint: node_modules/.package-lock.json ## the Lint job of CI: npm run lint, the shell of the run: blocks of the workflows
	@status=0; npm run lint || status=1; node .github/scripts/check-run-blocks.mts || status=1; exit $$status

test: node_modules/.package-lock.json ## the Unit tests job of CI: npm run test:unit, mocha over the compiled lib/
	npm run test:unit

build: ## the docker image IMAGE_REPO:VERSION for the platform of this machine: make build VERSION=<tag>
	docker build --progress=plain --provenance=false --build-arg VERSION=$(VERSION) --tag $(IMAGE_REPO):$(VERSION) .

push: ## the docker image IMAGE_REPO:VERSION for PLATFORMS, built by docker buildx and pushed: make push VERSION=<tag>
	@[[ "$(VERSION)" != dev ]] || { echo "make push VERSION=<tag>: the tag of the image is required"; exit 1; }
	@docker buildx inspect mcloud > /dev/null 2>&1 || docker buildx create --name mcloud --driver docker-container --driver-opt network=host > /dev/null
	docker buildx build --builder mcloud --progress=plain --provenance=false --platform $(PLATFORMS) \
	  --build-arg VERSION=$(VERSION) --tag $(IMAGE_REPO):$(VERSION) --push .

# The packages of package-lock.json, installed again when it changed: the hidden lock file of npm is the stamp; the
# prepare script of npm ci builds lib/ and the UI (node build.mts build)
node_modules/.package-lock.json: package-lock.json
	npm ci --no-audit --no-fund
	@touch $@
