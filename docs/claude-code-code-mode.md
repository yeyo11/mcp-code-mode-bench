# Measuring mode E (Claude Code Code Mode) by hand

Claude Code's Code Mode is experimental and, per its [docs](https://code.claude.com/docs/en/code-mode),
runs only in an **interactive terminal session**, after a one-time opt-in. Under `claude -p` the `REPL`
tool never appears (checked on v2.1.330): the model just calls the MCP tools one by one, which would
make "mode E" a second classic run. So:

- `npm run bench -- claude-code --mode D` measures mode D headless, as usual.
- `npm run bench -- claude-code --mode E` refuses: it stops the run as soon as Claude Code's init event
  lists no `REPL` tool, before the model is asked anything, and exits with code 4.
- Mode E is measured from the transcript of an interactive session, as below.

## Requirements

Claude Code v2.1.323 or later (native build), signed in directly to Anthropic (no gateway, Bedrock,
Vertex or Foundry, no API key helper), a supported model (Sonnet 5.5 here), no OpenTelemetry export,
no `DISABLE_TELEMETRY`. Some plugins and mods keep Code Mode off; the command below loads no settings
sources, so no plugins.

## Steps (one repetition)

1. Print the command for the task (it writes the MCP config and the prompt to a fixed temporary
   folder, so every session's transcript lands in the same project folder):

   ```sh
   npm run build
   npm run bench -- session-command --mode E --task T2
   ```

2. Run the printed command in a terminal. The first time, Claude Code asks you to confirm Code Mode:
   choose **Yes, turn on Code Mode**; it restarts.
3. Check the line near the top of the session: `Code Mode (experimental) is on`. If it says
   `isn't available`, `/status` gives the reason (see the docs' troubleshooting table). If the reason
   points at settings or plugins, fix that and start again.
4. The task prompt is already sent as the first message. Let it finish without typing anything else,
   then exit (`/exit`). Optional: `Ctrl+O` shows the JavaScript Claude wrote (screenshot material).
5. Turn the transcript into a results line:

   ```sh
   npm run bench -- transcript --latest --mode E --task T2 --rep 1
   ```

   `--latest` picks the newest transcript in
   `~/.claude/projects/-tmp-mcp-code-mode-bench-session/` (the folder name follows the session's
   working directory; pass `--file <path>` to choose one). The command fails, writing nothing, if the
   session never called `REPL`.

6. Repeat for each task and repetition. For a like-for-like comparison, run mode D the same way
   (`session-command --mode D`, then `transcript --mode D`), since interactive and headless sessions
   have different system prompts.

## What the transcript parser counts

- **Requests:** distinct assistant message ids (Claude Code logs one line per content block, all with
  the same id and usage). Subagent ("sidechain") requests are included and also counted apart.
- **Usage:** input, cache writes, cache reads and output summed over those requests.
- **Tool calls:** `REPL` blocks vs `mcp__*` blocks vs others.
- **Wall time:** from the first prompt's timestamp to the last assistant message's timestamp.
- **Cost:** the API price table in `bench/src/prices.ts` applied to that usage (an estimate: on a
  subscription nothing is billed per run).
- **Correctness:** the last assistant text, graded by the same checker; a run whose first prompt is not
  the task prompt is marked wrong.
