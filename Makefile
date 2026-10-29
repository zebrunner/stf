# The image of the STF of MCloud (ZEBRUNNER.md#build): `make build VERSION=<tag>` in the local docker, `make push
# VERSION=<tag>` builds PLATFORMS with docker buildx and pushes them (docker login public.ecr.aws first)
SHELL := /bin/bash
IMAGE_REPO ?= public.ecr.aws/zebrunner/stf
VERSION ?= dev
PLATFORMS ?= linux/amd64,linux/arm64

.DEFAULT_GOAL := help
.PHONY: help build push

help: ## this list
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/'

build: ## the docker image IMAGE_REPO:VERSION for the platform of this machine: make build VERSION=<tag>
	docker build --progress=plain --provenance=false --build-arg VERSION=$(VERSION) --tag $(IMAGE_REPO):$(VERSION) .

push: ## the docker image IMAGE_REPO:VERSION for PLATFORMS, built by docker buildx and pushed: make push VERSION=<tag>
	@[[ "$(VERSION)" != dev ]] || { echo "make push VERSION=<tag>: the tag of the image is required"; exit 1; }
	@docker buildx inspect mcloud > /dev/null 2>&1 || docker buildx create --name mcloud --driver docker-container --driver-opt network=host > /dev/null
	docker buildx build --builder mcloud --progress=plain --provenance=false --platform $(PLATFORMS) \
	  --build-arg VERSION=$(VERSION) --tag $(IMAGE_REPO):$(VERSION) --push .
