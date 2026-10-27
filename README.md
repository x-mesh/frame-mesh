# frame-mesh

English | [한국어](README.ko.md)

frame-mesh lets you edit a live web page like a design tool. Select an element, then move it, resize it, or change its spacing, text, and color. frame-mesh records each change, shows a diff against the original page, and packs the result into a handoff for an AI coding agent. The agent applies the handoff to your source code.

1. Select an element and change it on the page.
2. Check the change log and the diff.
3. Send the handoff to an agent, or chat with the agent from the page.

![frame-mesh in the Chrome extension on a Wikipedia article: change the title size, resize an image, move a figure, show the diff, and copy a handoff](docs/demo-extension.gif)

<sub>Demo page: the Wikipedia article [Web browser](https://en.wikipedia.org/wiki/Web_browser). The text and the video thumbnail ([Web browser demo.webm](https://commons.wikimedia.org/wiki/File:Web_browser_demo.webm), DecafPotato) are under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The screenshot `Safari 15.png` is in the public domain. frame-mesh has no relation to Wikipedia or the Wikimedia Foundation.</sub>

frame-mesh has two hosts. Both use the same editor engine.

- **Web workbench**: open a static HTML mockup and edit it at desktop, tablet, and mobile widths.
- **Chrome extension**: edit the page in the current tab, for example a local dev server or a public website.

frame-mesh changes only inline styles and the DOM order in the browser. It does not write to your source files.

> [!NOTE]
> The interface is in English and Korean. By default, it follows the browser language. To change it, click the gear (settings) button in the dock or in the top bar of the web workbench, and select a language under "Language". In the web workbench, `?lang=en` or `?lang=ko` in the URL also selects a language.

## Requirements

- Python 3 for the development server. The server needs no extra packages.
- Node.js for the syntax check in `make check` only.
- Chrome 116 or later, or a Chromium browser of the same version, for the extension.
- The `xm` command (optional). It delivers chat requests to the agent session automatically. It also finds sessions that have no frame-mesh MCP. Without `xm`, only a session with the MCP can receive requests, and it must wait for them.
- The `lsof` command (optional). The server uses it to find the project of a local page from the port of the page. Without `lsof`, the server uses the default project.

The project has no npm dependencies and no build step.

## Start with the web workbench

```bash
make dev
```

![frame-mesh web workbench: edit the sample mockup, check tablet and mobile widths, and review the diff](docs/demo-workbench.gif)

Open `http://127.0.0.1:4173/index.html`. The sample mockup `fixtures/sample-plan.en.html` opens (`fixtures/sample-plan.html` in Korean). If you see layers on the left, the preview in the center, and properties on the right, the workbench is ready. To open a different file, click "Open HTML" at the top.

Use the address that the server prints. If you open the file through `file://`, the workbench cannot load the mockup. To change the port, run `make dev PORT=5000`.

To work on your own project, run `frame-mesh dev` in the project folder. The command starts the same server for that folder. If a frame-mesh server already runs on the port, the command adds the folder to that server. See "Chat with an agent" to install the command.

## Start with the Chrome extension

You can install the extension from a release zip or from this repository. Both use **Load unpacked** in Chrome.

### Install from a release

1. Download `frame-mesh-extension-v<version>.zip` from the Releases page of this repository.
2. Unzip the file into a folder that you keep. If you delete the folder, the extension does not work.
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and select the unzipped folder.

The zip contains only the extension. Selection, edits, the change log, and "Copy for LLM" work without other files. "Save to project" and the "Chat" tab need the development server. For these features, get this repository. Run `make dev` in it, or run `frame-mesh dev` in your project folder.

To update, unzip the new release into the same folder. Then click the reload button on the frame-mesh card in `chrome://extensions`.

### Install from the repository

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the **root folder** of this repository. The extension loads the shared engine in `src/core/`, so `manifest.json` is in the root.

### Open the side panel

On the page to edit, click the frame-mesh icon in the toolbar. The side panel opens.

When the side panel opens, a dock appears at the bottom of the page. Click an element on the page to select it. The side panel follows the active tab and shows layers and properties. The dock holds the tools, the change log, and the handoff buttons. When you close the side panel, the page works normally again.

The extension requests access to all sites (`<all_urls>`). It injects code only into the active tab of the window with the open side panel.

## Edit a page

| Input | Result |
|---|---|
| Click | Selects the visible box under the pointer. It skips transparent link overlays. |
| Double-click | Selects one level deeper. On a text-only element, it starts a text edit. |
| ⌘-click (Ctrl-click on Windows) | Selects the deepest element. |
| Right-click | Shows a list of all elements at that point. |
| Drag | Changes the order or the parent in the same layout flow. If the "Free position" switch is on, it moves the element with a `position: relative` offset. Hold ⌥ (Option) to use the other mode. |
| Handles on the selection box | Change the width and height. Hold Shift on a corner handle to keep the aspect ratio. |
| Arrow keys | Move the element 1px. Hold Shift to move it 10px. |
| Enter | Starts a text edit on a text-only element. Press Enter to keep the text, or Esc to cancel. |
| ⌘Z / ⇧⌘Z | Undo / redo. |
| E | Switches between edit mode and normal page use. The extension accepts E only while the side panel is open. |
| Hold Space | Lets you use the page for a moment. Release Space to return to edit mode with the same selection and overlays. |

In edit mode, frame-mesh blocks links and page navigation. A blue top border on the dock shows that edit mode is on. To use the page, turn off the "Editing" switch at the left end of the dock, or press E. The "Free position" switch next to it sets the drag mode.

### Property panel

The property panel changes padding, margin, size, position, font, font size, letter spacing, line height, color, border, and layout. The font size list includes the size steps that the page uses.

- The header always shows the selected element and its number of changes.
- "Changed values" shows the original and the current value of each changed property. Click ↺ to revert one item.
- Values that you set show in dark text. Values that the page computes show in light text.
- Property groups open by element type. A group with changes shows its change count.
- The layer tree expands only the ancestors of the selection. An orange dot marks each changed element.

In the extension side panel, drag the bar between layers and properties to change their heights. Double-click the bar to reset it.

### View overlays

The "View" menu has these overlays. In the web workbench, they are buttons at the top.

- **Measure**: rulers, guides with coordinates and size, and distances to other elements.
- **Outline**: the area and name of each element on the screen.
- **Focus**: a dark mask outside the selected element.
- **Diff**: the original position (red dashes) and the current position (green) of each changed element, a move arrow, and the property changes.

## Review changes

Each changed element gets an orange dashed outline and a number. The dock shows "N applied", and the extension icon shows a badge. After you close the side panel, a "N changes applied" notice stays at the lower right of the page.

- **Log**: lists the changes in order. Click an entry to keep only the changes up to that point.
- **Summary**: shows the first and the last value of each element as a diff (`-` / `+`).
- **Show original**: removes the changes for a moment and shows the original page. Press Esc or start an edit to go back.
- **Reset**: removes all changes at once. The log stays, so redo can restore the changes one by one. To clear the log too, click the gear button in the dock and select "Revert all and clear log".

frame-mesh saves the change log for each page URL and applies it again after a reload. If frame-mesh cannot find an element, the change shows as "Restore failed". For elements that render late, frame-mesh tries again for 15 seconds.

## Hand off changes to an agent

The dock has three handoff actions.

- **Copy for LLM**: copies a Markdown handoff to the clipboard. The handoff contains the change list, the diff, a request to apply the changes, and the result HTML. For a large page, it contains only the HTML of the changed elements.
- **Save to project**: sends the handoff to the development server (`make dev` or `frame-mesh dev`). The server writes it to `.frame-mesh/handoffs/` in the project folder of the server.
- **View and save file**: shows the handoff and downloads it as `.md` or `.json`.

After "Save to project", give the agent a request like this one:

```text
Apply .frame-mesh/handoffs/latest.md to the source.
```

The server also creates `.frame-mesh/.gitignore`, so Git does not track the handoff files.

## Chat with an agent

The "Chat" tab sends requests to an AI coding agent session that runs in the target project folder. The tab is in the dock, or in the bottom panel of the web workbench. frame-mesh does not start an agent. Each request includes the selected element, its main styles, and the current diff.

A request goes to the session through `xm relay`. A session with the frame-mesh MCP answers with the MCP tools. A session without it answers with `frame-mesh` shell commands. One server can serve more than one project. See "Several projects on one server".

### Set up

Install the `frame-mesh` command once. Sessions without the MCP also use it to answer.

```bash
make install    # link ~/.local/bin/frame-mesh to bin/frame-mesh
```

If `~/.local/bin` is not in your `PATH`, add it. In this case, `make install` shows a notice.

To let sessions answer with MCP tools, register the MCP server once. This step is optional. A session without the MCP still works if `xm` is installed.

```bash
claude mcp add -s user frame-mesh -- frame-mesh mcp    # add the frame-mesh tools to every Claude Code session
```

For each project, start the server in the project folder.

```bash
cd <project> && frame-mesh dev
```

If a frame-mesh server already runs on the port, the command adds the folder to it and exits. Then run `claude` in the same folder. Open the page in the extension.

If you use another port, pass the new address to the MCP server. Sessions without the MCP need no setting. If the port is not 4173, the request message adds `--url` to the reply commands.

```bash
claude mcp add -s user -e FRAME_MESH_URL=http://127.0.0.1:5000 frame-mesh -- frame-mesh mcp
```

In this repository, `.mcp.json` already registers the `frame-mesh` server (`tools/fm_mcp.py`) for the project. Only Claude Code sessions register themselves with the server. For other agents, register `python3 tools/fm_mcp.py` as a stdio MCP server.

### Several projects on one server

One server can serve more than one project. Each project folder is a target. A target has its own chat, request queue, proposals, and connected session.

To add a project, run `frame-mesh dev` in its folder. If a frame-mesh server runs on the same port, the command adds the folder to that server and exits with code 0.

```text
frame-mesh: added /path/to/other to the server at http://127.0.0.1:4173
```

If the server already serves the folder, the message says `is already served by the server`. If another program uses the port, the command prints its PID and command, and exits with code 1. An older frame-mesh server cannot accept other projects. In this case, the command prints `an older frame-mesh server (PID n) uses port 4173` and the `kill` command to stop it.

The server runs in the terminal that started it. If you stop the server, it forgets the added projects. Run `frame-mesh dev` again to add them.

A request from the chat tab goes to one project. The server picks the project in this order.

1. The project that you choose in the chat tab. A project list appears when the server has two or more projects. The server keeps your choice for each page origin until it stops.
2. The project of the local server that serves the page. The page address must use `localhost`, `127.0.0.1`, or `[::1]` with a port other than the port of frame-mesh. The server runs `lsof` to find the process that opens the port. It uses the Git root of the current folder of that process and adds it to the projects.
3. The default project. This is the folder of the first `frame-mesh dev`.

For step 2, only processes of your own user count. The server skips your home folder and `/`. It keeps the result for 30 seconds for each port. If the server picks the wrong project, choose the right one in the list. When you change the project, the chat tab clears the conversation.

The web workbench opens the preview with `srcdoc`. It sends no page address, so it always uses the default project and shows no project list. To use another project in the workbench, start another server with `--port`.

A session finds its project from its own folder. `fm_get_state`, `fm_wait_request`, and `frame-mesh state` send the current folder of the session. If no project contains the folder of the session, `! frame-mesh connect` adds the Git root of that folder. A session that only registers itself does not add a project.

`frame-mesh reply` and `frame-mesh propose` find the project from the request ID. If you restart the server, it rejects the answer to an older request with `Unknown request id`. Send the request again from the chat tab.

### Find the session

The server looks for sessions in the target folder of the project and in the folders below it. It uses two ways, in this order.

1. Sessions with the frame-mesh MCP. A Claude Code session with the MCP registers itself when it opens in the folder. The session repeats the registration every 15 seconds. If the server gets no signal for 45 seconds, it removes the session from the list.
2. Sessions without the MCP. If `xm` is available, the server runs `xm relay sessions --provider claude`. It reuses the result for 5 seconds. If the command fails, the server finds no such session.

If both ways find the same session, the MCP entry stays. The chat tab marks a session from `xm` with `(CLI)`, as in `session b091f2d6 (CLI)`.

In a test, a request reached a session that was busy with other work. `xm` reports only that it wrote the message to the socket. It does not report when the session handles the message.

If a folder has more than one session, the server picks the receiving session in this order.

1. The session that you connected with `frame-mesh connect`. See "Connect a session".
2. The session that you select in the chat tab list. The list shows the name of each session, or the first 8 characters of its ID if it has no name. A duplicate session has one entry for each terminal. This selection clears the connection.
3. The MCP session that registered last.
4. The `(CLI)` session with the largest process ID (PID). This is an approximation of the session that started last.

Use `frame-mesh connect` as the main way to choose a session. The list and the automatic pick are fallbacks. Steps 3 and 4 skip a duplicate session until you choose a terminal. See "One session in two terminals".

> [!WARNING]
> Check the permissions of your agent before you use Auto delivery. If the agent runs without permission prompts and accepts outside messages without review, page text reaches the session directly.

### Connect a session

Run this command in the Claude Code session that must answer. The prefix `!` runs a shell command in the session.

```text
! frame-mesh connect
```

The command sends the session ID, the PID, and the current folder to the server. It reads the session ID and the PID from the environment variables `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID`. If one of them is not set, the command writes `frame-mesh: run this inside a Claude Code session, for example: ! frame-mesh connect` to stderr. The exit code is 2.

The server connects the session to the project that contains the current folder. If no project contains it, the server adds the Git root of the current folder as a project. Outside a Git repository, it adds the current folder. It does not add your home folder or `/`. If you use another server address, add `--url URL`.

On success, the command prints one line and the exit code is 0.

```text
frame-mesh: connected session 1b396d92 (PID 38858, cli) to /path/to/project
```

If the same session is open in another terminal, the command prints a second line. See "One session in two terminals".

The server then sends chat requests to this session. The status line shows the flag `connected`, as in `session 1b396d92 (CLI, connected)`.

The connection ends in these cases.

- You select another session in the chat tab list.
- You run `frame-mesh connect` in another session. That session replaces the connection.
- The process with the reported PID ends.

If the server rejects the request, the command writes the reason to stderr and the exit code is 1. If the server does not run, the exit code is also 1.

### One session in two terminals

Two terminals can run the same session. For example, you run `claude -c` in both. Both processes have one session ID and two PIDs. frame-mesh calls this session a duplicate. Sessions with and without the MCP can both be duplicates.

`xm relay` finds the process for a request by session ID only. It has no option to select a PID. If two processes share one ID, `xm` refuses to send. To reach one terminal, frame-mesh uses the environment variable `XM_RELAY_CLAUDE_BIN`. It replaces the `claude` command that `xm` runs. The wrapper `tools/fm_claude_agents.py` removes the other PIDs from the output of `claude agents --json`. Then `xm` sees one process. frame-mesh sets the variable only for the send call.

frame-mesh does not guess the terminal. You must choose it in one of two ways.

- Select the terminal in the chat tab list. A duplicate session has one entry for each terminal, as in `reviewer-ca (PID 38858) · idle · ttys000 · started 09:01`. The entry shows the state from `xm` (`busy` or `idle`), the terminal device, and the start time of the process. A start time before today also shows the month and the day.
- Run `! frame-mesh connect` in the terminal that must answer.

To find the entry of a terminal, run `! frame-mesh whoami` in it. The command does not need the server. It prints the same name, state, terminal device, and start time as the list. It also lists the other terminals of the same session.

```text
frame-mesh: this terminal is reviewer-02 (PID 98921) · idle · ttys059 · started 07:28 · session 1b396d92
frame-mesh: the same session is also open as reviewer-ca (PID 38858) · ttys000
```

If no relay command is available, the command prints the first 8 characters of the session ID as the name and does not show the state.

Until you choose a terminal, the delivery mode is manual and the request stays in the queue. The list shows "Choose a terminal". The status line shows the reason, as in "Duplicate session" below. The automatic pick skips the session.

After you choose a terminal, delivery is automatic. The status line ends with `session reviewer-ca (PID 38858)`. This works only if `xm` is the relay command and the `claude` command is in the `PATH` of the server. If not, the send fails and the request goes to the queue.

> [!WARNING]
> `XM_RELAY_CLAUDE_BIN` is not in the public documentation of `xm`. If `xm` changes how it selects a session, the PID selection can break.

To avoid a duplicate, start the second terminal with `claude -c --fork-session`. This option creates a new session ID. The source is `claude --help`. frame-mesh did not test it.

If you run `frame-mesh connect` in a duplicate session, the command sends requests to this terminal. It prints a second line and the exit code is 0.

```text
frame-mesh: connected session 1b396d92 (PID 38858, cli) to /path/to/project
frame-mesh: this session is also open in PID 56765. Requests go to this terminal (PID 38858).
```

### Sessions without the MCP

A session without the frame-mesh MCP answers with shell commands. The request message lists the commands, so you do not need to explain them to the agent.

| Command | Purpose |
|---|---|
| `frame-mesh reply <id> [text]` | Writes a text answer. If `text` is empty or `-`, the command reads the text from stdin. |
| `frame-mesh propose <id> --summary S --reason R [--ops-file F]` | Proposes a screen change. The ops JSON array comes from stdin or from the file `F`. |
| `frame-mesh state` | Reads the selection and the current diff. |
| `frame-mesh connect` | Sends chat requests to this session. Run it with `!` in a Claude Code session. See "Connect a session". |

All four commands accept `--url URL`. The default address is `FRAME_MESH_URL`, or `http://127.0.0.1:4173` if it is not set.

```bash
frame-mesh reply 3f9c1a2b <<'EOF'
I reduced the card padding to 8px.
EOF

frame-mesh propose 3f9c1a2b --summary "Reduce the card padding" --reason "The card looks loose next to the list." <<'EOF'
[{"kind": "style", "path": "<path>", "label": "<label>", "prop": "padding-top", "value": "8px"}]
EOF
```

The commands `reply`, `propose`, and `state` print one JSON line. If `ok` is false, the exit code is 1. `connect` prints text lines. If the input is invalid, the command writes one line to stderr and the exit code is 2. Invalid input is an empty text, ops that are not valid JSON, or ops that are not an array.

If the `PATH` of the server has no `frame-mesh`, the message uses the absolute path of `bin/frame-mesh`.

Claude Code asks for approval before each shell command. To skip the dialog for replies, add this rule. Put it in the `permissions.allow` list of your Claude Code `settings.json`.

```json
{
  "permissions": {
    "allow": ["Bash(frame-mesh:*)"]
  }
}
```

Without this rule, a dialog appears at each reply. The rule allows every `frame-mesh` command. If the message uses an absolute path, add a rule for that path.

| | Session with the MCP | Session without the MCP |
|---|---|---|
| Setup | Run `claude mcp add` once. | None on the session. `xm` must be installed. |
| Proposals | The tool declares the fields of the ops. | The agent writes the ops JSON by hand. Format errors can occur. |
| Wait mode | `fm_wait_request` works. | Not available. |

### Tools and delivery state

| Tool | Purpose |
|---|---|
| `fm_get_state` | Reads the selection, the current diff, and the status of each sent proposal. |
| `fm_reply` | Writes a text answer in the chat. |
| `fm_propose` | Proposes a screen change with a reason. The change applies only after the user previews and accepts it. |
| `fm_wait_request` | Waits for the next chat request. Use it when `xm` is not available. |

Under each request, the chat shows its delivery state. While the request waits for a reply ("Delivered · Waiting for a reply" or "Agent picked it up · Waiting for a reply"), a small animation shows before the text. If your system reduces motion, the animation does not move.

The status line above the chat tab shows the delivery state and the target folder. It has five forms.

- **Auto delivery**: `Auto delivery · reviewer · session b091f2d6`. `xm` sends the request to the session. For a session without the MCP, the line ends with `session b091f2d6 (CLI)`. For a session that you connected, the line ends with `session b091f2d6 (CLI, connected)`. For a duplicate session with a chosen terminal, the line ends with `session b091f2d6 (PID 38858)`. If the delivery fails, the request goes to the queue.
- **Agent waiting**: `Agent waiting · reviewer · session b091f2d6`. Tell the agent to wait for frame-mesh chat requests. The agent calls `fm_wait_request` and takes the next request. Each new wait call is one more model call. Only a session with the MCP can wait.
- **No session**: `Manual delivery · reviewer · No agent session in this folder · Run claude in <folder>`. The server found no session in the target folder.
- **No xm**: `Manual delivery · reviewer · xm is not installed · Tell the session with the frame-mesh MCP to receive frame-mesh chat`. A session with the MCP is open, but `xm` is not in your `PATH`. Without `xm`, the server cannot find sessions without the MCP.
- **Duplicate session**: `Manual delivery · reviewer · Session 1b396d92 is open in several terminals (PID 38858, 56765) · Choose a terminal in the list, or run ! frame-mesh connect in the one you want`. The session is open in two terminals, and you did not choose one. See "One session in two terminals".

If two or more sessions can receive requests, and you did not connect or select one, the line ends with a hint.

```text
Auto delivery · reviewer · session b091f2d6 (CLI) · 2 sessions · Run ! frame-mesh connect in the session that must answer
```

The number counts the sessions that can receive requests. A duplicate session counts after you choose a terminal.

In manual delivery, the request stays in a queue. The agent takes it when it starts to wait. "Copy for LLM" and `.frame-mesh/handoffs/` also work in this mode.

A proposal arrives as a card with its reason. Click "Preview" to apply it to the page. Click "Accept" to add it to the change log as one entry, which one undo removes. Click "Apply to source" to save the handoff to `.frame-mesh/handoffs/latest.md` and ask the agent to apply it to the source. The request contains a `Handoff file:` line with the absolute path. frame-mesh asks for source edits only when you click this button.

### Relay command

If `xm` is in your `PATH`, frame-mesh uses `xm relay --provider claude`. The server checks for `xm` at start and prints the result. You do not need to set anything.

To use another command, or to turn relay off, set environment variables when you start the server.

```bash
FRAME_MESH_RELAY_CMD="<command>" FRAME_MESH_RELAY_ARGS="<common args>" frame-mesh dev
```

If `FRAME_MESH_RELAY_CMD` is set, the server uses this command and not `xm`. If the value is empty, or if the server cannot find the command, relay is off. Then the server cannot find sessions without the MCP. `FRAME_MESH_RELAY_ARGS` replaces the default `--provider claude`.

The command must follow this contract.

| Call | Output |
|---|---|
| `<command> sessions <common args>` | JSON `{"sessions": [{"session_id": "...", "name": "...", "cwd": "...", "pid": 123}]}`. `name` and `pid` are optional. |
| `<command> send <common args> --session <id> --message-file <file>` | JSON `{"ok": true, "state": "..."}`. On failure, `ok: false` or a nonzero exit code. |

frame-mesh keeps only the sessions whose `cwd` is the target folder or a folder below it. If `sessions` fails or prints invalid JSON, frame-mesh uses an empty list.

Before frame-mesh runs the command, it removes each environment variable whose name ends in `_SESSION_ID`, `_THREAD_ID`, or `_CONVERSATION_ID`. Thus, if you start the server in an agent terminal, requests do not appear to come from that session.

frame-mesh puts page text into a block that is marked as data, not instructions, and limits its length.

## Development server

`make dev` and `frame-mesh dev` run `tools/devserver.py`. The server serves the repository root as static files. It also sends chat requests to the project folders and writes handoffs there.

The option `--target <folder>` sets the default target folder. The default is this repository, which `make dev` uses. `frame-mesh dev` sets the target to the Git root of the current folder. Outside a Git repository, it uses the current folder. Other projects join the server with `frame-mesh dev`. See "Several projects on one server".

The server prints four lines at start.

```text
frame-mesh: http://127.0.0.1:4173/index.html
target: /path/to/project  (handoffs: /path/to/project/.frame-mesh/handoffs)
other projects: run frame-mesh dev there; it joins this server.
relay: xm relay --provider claude (auto)
```

The fourth line shows the relay command. If no relay command is available, the line starts with `relay: off`.

If the port is in use, the command asks `GET /chat/targets` on that port. If a frame-mesh server answers, the command adds the folder and exits with code 0. If the server refuses the folder, the command prints the reason and exits with code 1. If another program uses the port, the command prints a notice and exits with code 1.

The server accepts handoffs at `POST /handoff`. `<target>` below is the project that the server picks for the request. The server writes `<target>/.frame-mesh/handoffs/<time>-<page>.md`, a `.json` file with the same name if the request has `json`, and `latest.md` with the newest handoff. At the first write, it also creates `.frame-mesh/.gitignore` with the line `*`. Thus Git ignores the folder, and your own `.gitignore` stays the same.

```bash
curl -X POST http://127.0.0.1:4173/handoff \
  -H 'Content-Type: application/json' \
  --data '{"source":"example","markdown":"# test"}'
```

The request body must contain `markdown`. The `json`, `source`, `page`, and `target` fields are optional. `page` is the origin of the page, and `target` is a project folder. Both select the project. The extension sends `page`. The response contains `dir`, the absolute path of the handoff folder, and `files`, the paths of the written `.md` and `.json` files relative to that project. The extension sends handoffs to `http://127.0.0.1:4173/handoff` by default. If you change the port, also change this address in the "View and save file" dialog.

The chat feature uses the `/chat/*` paths on the same server, for example `/chat/status`, `/chat/send`, and `/chat/events`. A session registers itself at `POST /chat/register` with `session_id` and `cwd`. The response tells whether `cwd` is in the target (`in_target`). `tools/fm_mcp.py` sends this request every 15 seconds and forwards the other requests to these paths. To change its server address, set `FRAME_MESH_URL`. The default is `http://127.0.0.1:4173`. The commands `frame-mesh reply`, `propose`, and `state` use the same paths through `tools/fm_cli.py`. Each entry in `sessions` of `/chat/status` has the fields `channel` (`mcp` or `cli`), `pid`, `pids`, `procs`, `ambiguous`, `pid_chosen`, and `pinned`. `procs` lists the `pid`, `name`, `status`, `tty`, and `started_at` of each process. `status` comes from `xm` and is `null` for an MCP session. `started_at` is in epoch seconds. `pid_chosen` is true if a terminal is chosen for the session. `pid` is the PID that receives requests. The top level of `/chat/status` has `pinned`, `hint`, `ambiguous`, `targets`, and `resolved_by`. `targets` lists the projects of the server. `resolved_by` tells how the server picked the project: `explicit`, `cwd`, `chosen`, `port`, or `default`.

`frame-mesh connect` sends `session_id`, `pid` (an integer), and `cwd` to `POST /chat/connect`. The response has `target`, `session_id`, `pid`, `channel`, and `ambiguous_pids`. `ambiguous_pids` lists the other PIDs of the same session. If no project contains `cwd`, the server adds the Git root of `cwd`, or `cwd` itself, as a project.

`POST /chat/session` takes `session_id` (or `null` to clear the selection) and `pid`. For a duplicate session, `pid` selects the terminal. If `pid` is not a positive integer, the server ignores it.

Most `/chat/*` paths and `/handoff` accept `page` and `target` to pick the project. GET paths take them in the query. POST paths take them in the body. If `target` is not a project of the server, the server answers with status 400. `GET /chat/state` and `GET /chat/wait` also accept `cwd`. They use the project that contains this folder. `POST /chat/reply`, `/chat/propose`, and `/chat/proposal` find the project from `request_id` or `proposal_id`. If the server does not know the ID, it answers with status 400 and `Unknown request id` or `Unknown proposal id`. The server forgets all IDs when it stops. It also forgets the oldest IDs above 2000.

Three paths manage projects.

| Path | Action |
|---|---|
| `GET /chat/targets` | Returns `frame_mesh` (always `true`), `default`, and `targets`. Each target has `target` and `target_name`. |
| `POST /chat/targets` | Adds the folder in `path`. The response has `target` and `added`. A request with an `Origin` header gets status 403, so only local commands can add projects. A path that is not a folder gets status 400. |
| `POST /chat/target` | Binds the project `target` to the page origin `page`. Both fields are required. The project must be in the list. The response is the status of that project. |

For `/chat/*` and `/handoff`, the server accepts browser requests only from its own origin and from Chrome extensions. POST requests must use `Content-Type: application/json`. These rules block requests from other websites to `127.0.0.1` that try to put instructions into an agent session. Local programs that are not browsers, such as `curl`, can use these paths.

## Make targets

| Target | Action |
|---|---|
| `make dev` | Runs the development server. The target is this repository. Set `PORT` and `HOST` to change the address. |
| `make install` | Links `~/.local/bin/frame-mesh` to `bin/frame-mesh`. Set `BIN_DIR` to change the folder. |
| `make uninstall` | Removes that link. It skips a file that is not a link. |
| `make open` | Opens the workbench in the default browser. It uses the macOS `open` command. |
| `make check` | Checks the JS syntax and `manifest.json`. |
| `make test` | Prints a notice. No automated tests exist yet. |
| `make package` | Builds the release zip `dist/frame-mesh-extension-v<version>.zip`. The version comes from `manifest.json`. |
| `make demo` | Records the demo GIFs in `docs/` again. It needs `make dev`, the loaded extension, `ego-browser`, and `ffmpeg`. |
| `make clean` | Removes `.DS_Store` files. |
| `make help` | Lists the targets. |

## Project layout

```text
src/core/      Editor engine (selection, move, resize, history, measure, diff) and handoff builder
src/panel/     Layer and property panels, the dock for the extension, and the chat tab
src/web/       Web workbench host (iframe preview, viewports)
bin/           The `frame-mesh` command (`dev`, `mcp`, `reply`, `propose`, `state`, and `connect`)
extension/     Extension background script, content script, and side panel
tools/         Development server, page-to-project lookup, chat relay, MCP server, reply command, and `xm` wrapper
tools/demo/    Demo recorder (`make demo`)
fixtures/      Sample mockups (static page, late render, card with a link overlay)
docs/          Demo GIFs
```

The web workbench and the extension use the same engine. A feature in the engine works in both hosts.

## Known limitations

- Edits are inline styles. The agent that receives the handoff must move them into the source CSS or component code.
- Apps that render the page again, such as React apps, can overwrite applied changes. frame-mesh then tries to apply them again. If that fails, the change shows as "Restore failed".
- If an original value comes from a CSS rule, the diff shows it as `(default)`.
- "Changed values" uses the computed value just before the first change as the original value. Text changes have no ↺ button.
- frame-mesh cannot edit inside a cross-origin iframe, such as an ad. It treats the iframe as one element.
- frame-mesh does not create rules for each viewport (media queries). Each change applies at all widths.
- A session in a Git worktree is not a candidate if the worktree folder is outside the target folder. The worktree has its own Git root.
- A session without the frame-mesh MCP cannot use `fm_wait_request`. The server finds it only through `xm`.
- If you do not connect or select a session, the default is the MCP session that registered last. Without an MCP session, it is the `(CLI)` session with the largest PID. The PID order is an approximation. If the default is wrong, run `! frame-mesh connect` in the session that must answer.
- A session with one session ID in more than one terminal, such as `claude -c` in two terminals, receives requests only after you choose a terminal. This depends on `XM_RELAY_CLAUDE_BIN`, an environment variable that is not in the public documentation of `xm`. If `xm` changes how it selects a session, the PID selection can break. It does not work with `FRAME_MESH_RELAY_CMD`.
- The port lookup works only for local pages and for processes of your own user. It does not find the project of a Docker container or of a remote development server. If the server finds no project, it uses the default project. To use another project, add it with `frame-mesh dev` and choose it in the chat tab list.

The design background and requirements are in [UI-UX-WORKBENCH-REQUIREMENTS.md](UI-UX-WORKBENCH-REQUIREMENTS.md) (Korean).

## Third-party code

`src/panel/thinking-orbs.js` is the engine of [thinking-orbs](https://www.npmjs.com/package/thinking-orbs) 0.3.1 (MIT License, Copyright (c) 2026 Jakub Antalik). The chat tab uses its `connecting` animation while it waits for a reply. The file keeps the license notice at the top.
