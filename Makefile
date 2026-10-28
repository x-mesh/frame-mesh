# frame-mesh — 로컬 UI 작업실
#
# 사용법: make <target>   (목록은 make help)

PORT ?= 4173
HOST ?= 127.0.0.1
URL  := http://$(HOST):$(PORT)/index.html
JS   := $(wildcard src/*/*.js extension/*.js)
BIN_DIR ?= $(HOME)/.local/bin

.DEFAULT_GOAL := help
.PHONY: help dev install uninstall open check test demo package package-cli clean

help: ## 사용할 수 있는 target 목록
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: ## 개발 서버 실행 (대상 = 이 저장소): 정적 파일 + 전달 묶음 수신(POST /handoff → .frame-mesh/handoffs/). PORT, HOST 변경 가능
	python3 tools/devserver.py --port $(PORT) --bind $(HOST)

install: ## frame-mesh 명령 설치: ~/.local/bin/frame-mesh 심볼릭 링크 만들기 (BIN_DIR 변경 가능)
	mkdir -p "$(BIN_DIR)"
	ln -sfn "$(abspath bin/frame-mesh)" "$(BIN_DIR)/frame-mesh"
	@echo "ok  $(BIN_DIR)/frame-mesh"
	@case ":$$PATH:" in *":$(BIN_DIR):"*) ;; *) echo '주의: $(BIN_DIR)가 PATH에 없습니다. 셸 설정에 export PATH="$(BIN_DIR):$$PATH"를 추가하세요.' ;; esac

# 링크가 아닌 파일은 사용자가 직접 둔 것일 수 있어 지우지 않는다.
uninstall: ## frame-mesh 명령 제거: 설치한 심볼릭 링크 지우기
	@if [ -L "$(BIN_DIR)/frame-mesh" ]; then rm "$(BIN_DIR)/frame-mesh" && echo "ok  removed $(BIN_DIR)/frame-mesh"; else echo "심볼릭 링크가 없어 건너뜁니다: $(BIN_DIR)/frame-mesh"; fi

open: ## 기본 브라우저로 작업실 열기 (서버가 떠 있어야 함)
	open "$(URL)"

check: ## JS 문법 검사와 manifest.json 검사
	@for f in $(JS); do node --check "$$f" && echo "ok  $$f"; done
	@python3 -c "import json; json.load(open('manifest.json')); print('ok  manifest.json')"

test: ## 자동 테스트 (아직 없음)
	@echo "자동 테스트가 아직 없습니다. 검증 절차는 UI-UX-WORKBENCH-REQUIREMENTS.md 9절을 따릅니다."

# 확장은 manifest.json, _locales/, extension/, src/core/, src/panel/만 읽는다. 개발 서버와 예제는 zip에 넣지 않는다.
package: ## 확장 배포용 zip 만들기: dist/frame-mesh-extension-v<버전>.zip (Release 첨부용)
	@version=$$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])"); \
	out="dist/frame-mesh-extension-v$$version.zip"; \
	mkdir -p dist && rm -f "$$out" && \
	zip -qr "$$out" manifest.json _locales extension src/core src/panel -x '*.DS_Store' && \
	echo "ok  $$out"

# CLI 묶음은 frame-mesh 명령이 쓰는 파일만 담는다: 명령, 서버·대화 도구, 서버가 보여 주는 웹 작업실과 기본 예제,
# 버전을 읽는 manifest.json. install.sh가 이 묶음과 체크섬을 Release에서 받는다. macOS tar가 확장 속성 파일(._*)을 넣지 않게 COPYFILE_DISABLE을 둔다.
CLI_FILES := bin/frame-mesh tools/chat.py tools/devserver.py tools/targets.py tools/fm_mcp.py tools/fm_cli.py tools/fm_claude_agents.py \
	index.html styles.css manifest.json src fixtures/sample-plan.html fixtures/sample-plan.en.html
package-cli: ## frame-mesh 명령 배포 묶음 만들기: dist/frame-mesh-cli-v<버전>.tar.gz와 .sha256 (Release 첨부용)
	@version=$$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])"); \
	name="frame-mesh-cli-v$$version"; out="dist/$$name.tar.gz"; stage=$$(mktemp -d); \
	mkdir -p dist "$$stage/$$name" && rm -f "$$out" "$$out.sha256" && \
	for f in $(CLI_FILES); do mkdir -p "$$stage/$$name/$$(dirname $$f)" && cp -R "$$f" "$$stage/$$name/$$f"; done && \
	find "$$stage" -name '.DS_Store' -delete && \
	COPYFILE_DISABLE=1 tar -czf "$$out" -C "$$stage" "$$name" && rm -rf "$$stage" && \
	python3 -c "import hashlib,os,sys; p=sys.argv[1]; print(hashlib.sha256(open(p,'rb').read()).hexdigest() + '  ' + os.path.basename(p))" "$$out" > "$$out.sha256" && \
	echo "ok  $$out" && echo "ok  $$out.sha256"

# ego-browser 출력을 파이프로 거르면 결과가 사라지는 경우가 있어 그대로 둔다.
demo: ## 시연 GIF 다시 만들기 (make dev 서버, 확장 로드, ego-browser, ffmpeg 필요)
	ego-browser nodejs -e "await import('file://$(CURDIR)/tools/demo/extension.mjs')" </dev/null
	tools/demo/build.sh extension
	ego-browser nodejs -e "await import('file://$(CURDIR)/tools/demo/workbench.mjs')" </dev/null
	GIF_WIDTH=1400 tools/demo/build.sh workbench

clean: ## 생성 파일 정리 (.DS_Store)
	find . -name .DS_Store -delete
