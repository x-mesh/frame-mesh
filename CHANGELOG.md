# Changelog

All notable changes to frame-mesh are in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Shift-click selection. Shift-click adds an element to the selection or removes it, up to 10 elements. Editing still applies to the last selected element only. `getChatContext` and `getState` have the new field `selections`, and the engine has the new method `selectTargets`.
- Selected elements in the chat. The chat tab shows the selected elements above the input. Each sent request keeps them in an "About" row of its bubble. Click a name to select the elements again. The `user` chat event has the new field `selection` with `id`, `label`, `path`, and `excerpt` of each element.
- A waiting animation in the chat. While a request waits for a reply, the `connecting` animation of thinking-orbs 0.3.1 (MIT) shows before the delivery state. The engine is in `src/panel/thinking-orbs.js`. If the system reduces motion, the animation does not move.

- The `frame-mesh` command with `frame-mesh dev` (starts the server for the current project) and `frame-mesh mcp`. `make install` and `make uninstall` add and remove the link in `~/.local/bin`.
- Session registration. A Claude Code session that has the frame-mesh MCP and opens in the target folder registers itself with the server every 15 seconds.
- Automatic `xm` detection. If `xm` is in `PATH`, chat requests go to the session through `xm relay --provider claude`. `FRAME_MESH_RELAY_CMD` still replaces the command, and an empty value turns relay off.
- Chat with sessions that have no frame-mesh MCP. frame-mesh finds them with `xm relay sessions --provider claude` and marks them with `(CLI)` in the chat tab. The request message tells the session to answer with shell commands.
- The `frame-mesh reply`, `frame-mesh propose`, and `frame-mesh state` commands. A session without the MCP uses them to answer, to propose a screen change, and to read the selection. Each command accepts `--url`.
- The `channel` (`mcp` or `cli`) and `pid` fields for each session in `/chat/status`.
- The `frame-mesh connect` command and `POST /chat/connect`. Run `! frame-mesh connect` in a Claude Code session to send chat requests to that session. The chat tab shows the flag as in `session 1b396d92 (CLI, connected)`. The connection ends when you select another session in the list, or when the process with the reported PID ends.
- Duplicate session detection. If one session ID runs in more than one process, for example `claude -c` in two terminals, frame-mesh does not send requests until you choose a terminal. `xm relay` finds the process for a request by session ID only. Each entry in `sessions` of `/chat/status` has the new fields `pids`, `ambiguous`, and `pinned`. The response also has the new top-level fields `pinned`, `hint`, and `ambiguous`.
- Delivery to one terminal of a duplicate session. Select the terminal in the chat tab list, or run `! frame-mesh connect` in it. frame-mesh sets `XM_RELAY_CLAUDE_BIN` for the `xm` send call. The wrapper `tools/fm_claude_agents.py` removes the other PIDs from `claude agents --json`. `XM_RELAY_CLAUDE_BIN` is not in the public documentation of `xm`. If `xm` changes how it selects a session, this can break. It works only with `xm` and needs `claude` in the `PATH` of the server. `POST /chat/session` takes the new field `pid`. Each entry in `sessions` of `/chat/status` has the new fields `procs` and `pid_chosen`. Each entry in `procs` has `pid`, `name`, `status`, `tty`, and `started_at`. The chat tab list shows the state, the terminal device, and the start time of each terminal.
- The `frame-mesh whoami` command. Run `! frame-mesh whoami` in a Claude Code session. It prints how the terminal appears in the chat tab list: the name, the state, the terminal device, and the start time. It also lists the other terminals of the same session. It does not need the server.
- Several projects on one server. Each project folder is a target with its own chat, queue, proposals, and connected session. The chat tab, the dock handoff, `fm_get_state`, `fm_wait_request`, and `frame-mesh state` send the page origin or the current folder, and the server picks the project. For a local page, the server finds the project from the port of the page with `lsof`. For the other cases, you choose the project in the chat tab list. `/chat/status` has the new fields `targets` and `resolved_by`. The new paths are `GET /chat/targets`, `POST /chat/targets` (local requests without an `Origin` header only), and `POST /chat/target`. `POST /handoff` accepts `page` and `target`.
- `lsof` is an optional requirement. Without it, the server uses the default project.
- A hint in the chat status line when two or more sessions are candidates and you did not connect or select one: `2 sessions · Run ! frame-mesh connect in the session that must answer`.
- The chat status line shows the target folder and the reason for the delivery state, for example `Auto delivery · reviewer · session b091f2d6`.
- The `--target` option of the development server, and a start output with the address, the target folder, and the relay command.

### Changed

- Handoffs go to `.frame-mesh/handoffs/` in the target folder, not to `handoffs/` in this repository. The server also creates `.frame-mesh/.gitignore`, so Git does not track them.
- Chat requests go to a session in the target folder: a session that registered with the MCP, or a session that `xm relay sessions` reports. If both find the same session, the MCP entry stays.
- If a folder has more than one session, the receiving session is the one you connected with `frame-mesh connect`, then the session you select in the list, then the MCP session that registered last, then the `(CLI)` session with the largest PID. Selecting a session in the list clears the connection. The PID order is an approximation.
- A session that runs in more than one process no longer counts as a normal candidate until you choose a terminal. The automatic pick skips it. Until then, the delivery mode is manual and the status line shows the reason.
- `frame-mesh dev` joins a running frame-mesh server on the same port. It adds the folder as a project and exits with code 0. Before, the command stopped with an error. If another program uses the port, the error now names its PID and command. For an older frame-mesh server, it also prints the `kill` command. The server prints a fourth start line, `other projects: run frame-mesh dev there; it joins this server.`
- `frame-mesh connect` works in a duplicate session. It connects the terminal, prints a second line with the other PIDs, and exits with code 0. If no project contains the current folder, it adds the Git root of the folder as a project.
- The server rejects the answer to a request that it does not know, for example after a restart, with `Unknown request id`.
- Without `xm`, the server cannot find sessions without the MCP. A session without the MCP cannot use `fm_wait_request`.

## [0.1.2] - 2026-10-27

### Changed

- The README demo GIFs show the current interface: the "Free position" switch, the settings (gear) menu, and English labels.

## [0.1.1] - 2026-10-27

### Fixed

- The E and Cmd+Z shortcuts did nothing while the Korean input method was on. They now also match the physical key.
- On pages that put focus in an input on load, such as naver.com, every shortcut went to that input until you clicked a dock button. Edit mode now releases focus from page inputs and from the dock chat input when editing starts and when you click the page.

## [0.1.0] - 2026-10-27

First release. Select, move, resize, and restyle elements on a live web page, review the changes against the original, and hand them to an AI coding agent that applies them to your source.

### Added

- Chrome extension: a side panel with layers and properties, and a dock on the page with the change log, the diff, and handoff actions
- Web workbench for static HTML mockups at desktop, tablet, and mobile widths
- Edit switch (E), hold Space to use the page, "Free position" drag mode, undo, redo, and reset to the original
- Diff overlay and change summary, "Copy for LLM", and "Save to project" into `handoffs/`
- Chat with a running agent session through MCP tools, with proposals that you preview and accept
- English and Korean interface, selectable in the settings menu

[Unreleased]: https://github.com/x-mesh/frame-mesh/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/x-mesh/frame-mesh/releases/tag/v0.1.0
