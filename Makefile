# frame-mesh — 로컬 UI 작업실
#
# 사용법: make <target>   (목록은 make help)

PORT ?= 4173
HOST ?= 127.0.0.1
URL  := http://$(HOST):$(PORT)/index.html
JS   := $(wildcard src/*/*.js extension/*.js)

.DEFAULT_GOAL := help
.PHONY: help dev open check test clean

help: ## 사용할 수 있는 target 목록
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: ## 개발 서버 실행: 정적 파일 + 전달 묶음 수신(POST /handoff → handoffs/). PORT, HOST 변경 가능
	python3 tools/devserver.py --port $(PORT) --bind $(HOST)

open: ## 기본 브라우저로 작업실 열기 (서버가 떠 있어야 함)
	open "$(URL)"

check: ## JS 문법 검사와 manifest.json 검사
	@for f in $(JS); do node --check "$$f" && echo "ok  $$f"; done
	@python3 -c "import json; json.load(open('manifest.json')); print('ok  manifest.json')"

test: ## 자동 테스트 (아직 없음)
	@echo "자동 테스트가 아직 없습니다. 검증 절차는 UI-UX-WORKBENCH-REQUIREMENTS.md 9절을 따릅니다."

clean: ## 생성 파일 정리 (.DS_Store)
	find . -name .DS_Store -delete
