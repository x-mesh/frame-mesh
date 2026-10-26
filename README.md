# frame-mesh

English | [한국어](README.ko.md)

frame-mesh lets you edit a live web page like a design tool. Select an element, then move it, resize it, or change its spacing, text, and color. frame-mesh records each change, shows a diff against the original page, and packs the result into a handoff for an AI coding agent. The agent applies the handoff to your source code.

1. Select an element and change it on the page.
2. Check the change log and the diff.
3. Send the handoff to an agent, or chat with the agent from the page.

frame-mesh has two hosts. Both use the same editor engine.

- **Web workbench**: open a static HTML mockup and edit it at desktop, tablet, and mobile widths.
- **Chrome extension**: edit the page in the current tab, for example a local dev server or a public website.

frame-mesh changes only inline styles and the DOM order in the browser. It does not write to your source files.

> [!NOTE]
> The user interface is in Korean. This README gives each label in Korean with an English translation, for example "LLM용 복사" (Copy for LLM).

## Requirements

- Python 3 for the development server. The server needs no extra packages.
- Node.js for the syntax check in `make check` only.
- Chrome 116 or later, or a Chromium browser of the same version, for the extension.

The project has no npm dependencies and no build step.

## Start with the web workbench

```bash
make dev
```

Open `http://127.0.0.1:4173/index.html`. The sample mockup `fixtures/sample-plan.html` opens. If you see layers on the left, the preview in the center, and properties on the right, the workbench is ready. To open a different file, click "HTML 열기" (Open HTML) at the top.

Use the `make dev` address. If you open the file through `file://`, the workbench cannot load the mockup. To change the port, run `make dev PORT=5000`.

## Start with the Chrome extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the **root folder** of this repository. The extension loads the shared engine in `src/core/`, so `manifest.json` is in the root.
3. On the page to edit, click the frame-mesh icon in the toolbar. The side panel opens.

When the side panel opens, a dock appears at the bottom of the page. Click an element on the page to select it. The side panel follows the active tab and shows layers and properties. The dock holds the tools, the change log, and the handoff buttons. When you close the side panel, the page works normally again.

The extension requests access to all sites (`<all_urls>`). It injects code only into the active tab of the window with the open side panel.

## Edit a page

| Input | Result |
|---|---|
| Click | Selects the visible box under the pointer. It skips transparent link overlays. |
| Double-click | Selects one level deeper. On a text-only element, it starts a text edit. |
| ⌘-click (Ctrl-click on Windows) | Selects the deepest element. |
| Right-click | Shows a list of all elements at that point. |
| Drag | Changes the order or the parent in the same layout flow. Hold ⌥ (Option) to move the element with a `position: relative` offset. |
| Handles on the selection box | Change the width and height. Hold Shift on a corner handle to keep the aspect ratio. |
| Arrow keys | Move the element 1px. Hold Shift to move it 10px. |
| Enter | Starts a text edit on a text-only element. Press Enter to keep the text, or Esc to cancel. |
| ⌘Z / ⇧⌘Z | Undo / redo. |
| E | Switches between edit mode and normal page use. The extension accepts E only while the side panel is open. |
| Hold Space | Lets you use the page for a moment. Release Space to return to edit mode with the same selection and overlays. |

In edit mode, frame-mesh blocks links and page navigation. A blue top border on the dock shows that edit mode is on. To use the page, turn off the "편집 중" (Edit mode) switch at the left end of the dock, or press E.

### Property panel

The property panel changes padding, margin, size, position, font, font size, letter spacing, line height, color, border, and layout. The font size list includes the size steps that the page uses.

- The header always shows the selected element and its number of changes.
- "바꾼 값" (Changed values) shows the original and the current value of each changed property. Click ↺ to revert one item.
- Values that you set show in dark text. Values that the page computes show in light text.
- Property groups open by element type. A group with changes shows its change count.
- The layer tree expands only the ancestors of the selection. An orange dot marks each changed element.

In the extension side panel, drag the bar between layers and properties to change their heights. Double-click the bar to reset it.

### View overlays

The "보기" (View) menu has these overlays. In the web workbench, they are buttons at the top.

- **측정 (Measure)**: rulers, guides with coordinates and size, and distances to other elements.
- **분해 (Outline)**: the area and name of each element on the screen.
- **집중 (Focus)**: a dark mask outside the selected element.
- **차이 표시 (Diff)**: the original position (red dashes) and the current position (green) of each changed element, a move arrow, and the property changes.

## Review changes

Each changed element gets an orange dashed outline and a number. The dock shows "N건 적용 중" (N changes applied), and the extension icon shows a badge. After you close the side panel, a "변경 N건 적용 중" notice stays at the lower right of the page.

- **로그 (Log)**: lists the changes in order. Click an entry to keep only the changes up to that point.
- **변경 요약 (Summary)**: shows the first and the last value of each element as a diff (`-` / `+`).
- **원본 보기 (Show original)**: removes the changes for a moment and shows the original page. Press Esc or start an edit to go back.
- **처음 상태로 (Reset)**: removes all changes at once. The log stays, so redo can restore the changes one by one. To clear the log too, open the ⋯ menu in the dock and select "모두 되돌리고 로그 지우기" (Revert all and clear log).

frame-mesh saves the change log for each page URL and applies it again after a reload. If frame-mesh cannot find an element, the change shows as "복원 실패" (Restore failed). For elements that render late, frame-mesh tries again for 15 seconds.

## Hand off changes to an agent

The dock has three handoff actions.

- **LLM용 복사 (Copy for LLM)**: copies a Markdown handoff to the clipboard. The handoff contains the change list, the diff, a request to apply the changes, and the result HTML. For a large page, it contains only the HTML of the changed elements.
- **프로젝트에 저장 (Save to project)**: sends the handoff to the `make dev` server. The server writes it to `handoffs/`.
- **내용 보기·파일 저장 (View and save file)**: shows the handoff and downloads it as `.md` or `.json`.

After "프로젝트에 저장", give the agent a request like this one:

```text
Apply handoffs/latest.md to the source.
```

## Chat with an agent

The "대화" (Chat) tab sends requests to an AI coding agent session that runs in this project folder. The tab is in the dock, or in the bottom panel of the web workbench. frame-mesh does not start an agent. Each request includes the selected element, its main styles, and the current diff.

The agent answers through the frame-mesh MCP tools. `.mcp.json` registers the `frame-mesh` server (`tools/fm_mcp.py`). An agent that reads `.mcp.json` uses this server when you open it in this folder. For other agents, register `python3 tools/fm_mcp.py` as a stdio MCP server.

| Tool | Purpose |
|---|---|
| `fm_get_state` | Reads the selection, the current diff, and the status of each sent proposal. |
| `fm_reply` | Writes a text answer in the chat. |
| `fm_propose` | Proposes a screen change with a reason. The change applies only after the user previews and accepts it. |
| `fm_wait_request` | Waits for the next chat request. Use it when no relay command is set. |

frame-mesh selects one of three delivery modes and shows it above the chat tab.

- **Relay**: if a relay command is set (see below) and it finds an agent session in this folder, the request goes to that session directly. If there is more than one session, select one in the chat tab.
- **Agent wait**: tell the agent to wait for frame-mesh chat requests. The agent calls `fm_wait_request` and takes the next request. Each new wait call is one more model call.
- **Manual**: if neither mode applies, the request stays in a queue. The agent takes it when it starts to wait. "LLM용 복사" and `handoffs/` also work in this mode.

A proposal arrives as a card with its reason. Click "미리보기" (Preview) to apply it to the page. Click "수락" (Accept) to add it to the change log as one entry, which one undo removes. Click "원본에 반영" (Apply to source) to save the handoff to `handoffs/latest.md` and ask the agent to apply it to the source. frame-mesh asks for source edits only when you click this button.

### Relay command

For relay mode, set the command in environment variables when you start the development server.

```bash
FRAME_MESH_RELAY_CMD="<command>" FRAME_MESH_RELAY_ARGS="<common args>" make dev
```

The command must follow this contract.

| Call | Output |
|---|---|
| `<command> sessions <common args>` | JSON `{"sessions": [{"session_id", "name", "status", "cwd"}]}`. frame-mesh uses only the sessions whose `cwd` is this repository folder. |
| `<command> send <common args> --session <id> --message-file <file>` | JSON `{"ok": true, "state": "..."}`. On failure, `ok: false` or a nonzero exit code. |

Before frame-mesh runs the command, it removes each environment variable whose name ends in `_SESSION_ID`, `_THREAD_ID`, or `_CONVERSATION_ID`. Thus, if you start the server in an agent terminal, requests do not appear to come from that session.

frame-mesh puts page text into a block that is marked as data, not instructions, and limits its length.

> [!WARNING]
> Check the permissions of your agent before you use relay mode. If the agent runs without permission prompts and accepts outside messages without review, page text reaches the session directly.

## Development server

`make dev` runs `tools/devserver.py`. The server serves the repository root as static files. It also accepts handoffs at `POST /handoff` and writes three files: `handoffs/<time>-<page>.md`, a `.json` file with the same name, and `handoffs/latest.md` with the newest handoff.

```bash
curl -X POST http://127.0.0.1:4173/handoff \
  -H 'Content-Type: application/json' \
  --data '{"source":"example","markdown":"# test"}'
```

The request body must contain `markdown`. The `json` and `source` fields are optional. The extension sends handoffs to `http://127.0.0.1:4173/handoff` by default. If you change the port, also change this address in the "내용 보기·파일 저장" dialog.

The chat feature uses the `/chat/*` paths on the same server, for example `/chat/status`, `/chat/send`, and `/chat/events`. `tools/fm_mcp.py` only forwards requests to these paths. To change its server address, set `FRAME_MESH_URL`. The default is `http://127.0.0.1:4173`.

For `/chat/*` and `/handoff`, the server accepts browser requests only from its own origin and from Chrome extensions. POST requests must use `Content-Type: application/json`. These rules block requests from other websites to `127.0.0.1` that try to put instructions into an agent session. Local programs that are not browsers, such as `curl`, can use these paths.

## Make targets

| Target | Action |
|---|---|
| `make dev` | Runs the development server. Set `PORT` and `HOST` to change the address. |
| `make open` | Opens the workbench in the default browser. It uses the macOS `open` command. |
| `make check` | Checks the JS syntax and `manifest.json`. |
| `make test` | Prints a notice. No automated tests exist yet. |
| `make clean` | Removes `.DS_Store` files. |
| `make help` | Lists the targets. |

## Project layout

```text
src/core/      Editor engine (selection, move, resize, history, measure, diff) and handoff builder
src/panel/     Layer and property panels, and the dock for the extension
src/web/       Web workbench host (iframe preview, viewports)
extension/     Extension background script, content script, and side panel
tools/         Development server, chat relay, and MCP server
fixtures/      Sample mockups (static page, late render, card with a link overlay)
```

The web workbench and the extension use the same engine. A feature in the engine works in both hosts.

## Known limitations

- Edits are inline styles. The agent that receives the handoff must move them into the source CSS or component code.
- Apps that render the page again, such as React apps, can overwrite applied changes. frame-mesh then tries to apply them again. If that fails, the change shows as "복원 실패".
- If an original value comes from a CSS rule, the diff shows it as `(기본)` (default).
- "바꾼 값" uses the computed value just before the first change as the original value. Text changes have no ↺ button.
- frame-mesh cannot edit inside a cross-origin iframe, such as an ad. It treats the iframe as one element.
- frame-mesh does not create rules for each viewport (media queries). Each change applies at all widths.

The design background and requirements are in [UI-UX-WORKBENCH-REQUIREMENTS.md](UI-UX-WORKBENCH-REQUIREMENTS.md) (Korean).
