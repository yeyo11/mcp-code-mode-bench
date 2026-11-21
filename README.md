# mcp-code-mode-bench

How many tokens, model round trips and seconds does an agent spend on the same task, against the
same MCP server, when it calls the tools one by one, and when it writes code that calls them? And
when does Code Mode **not** pay off?

This repository measures it, with a mock MCP server whose answers are known in advance, so every run
is graded by code. Write-up: [the article on josegarrido.dev](https://josegarrido.dev/?utm_source=github&utm_medium=referral&utm_campaign=mcp-code-mode-bench-readme).

## The three "Code Modes"

1. **Cloudflare Code Mode** (Sept 2025) named the idea: turn MCP tools into a TypeScript API, let the model write code against it, run it in a V8 isolate ([blog](https://blog.cloudflare.com/code-mode/), [the API in ~1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/)). Not benchmarked here: another stack, and deploying needs Workers Paid.
2. **Claude API programmatic tool calling** (stable, no beta header): Claude writes Python in the code execution container and calls your tools from it, so intermediate results never enter its context ([docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling); the pattern in [Anthropic's engineering post](https://www.anthropic.com/engineering/code-execution-with-mcp)). Mode C.
3. **Claude Code Code Mode** (experimental, v2.1.323+): Claude writes JavaScript that calls Bash, Read, Edit and MCP tools through a `REPL` tool, on with `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` ([docs](https://code.claude.com/docs/en/code-mode)). Mode E.

The idea itself is older: [CodeAct](https://arxiv.org/abs/2402.01030) (2024) used executable code as the agent's action space.

## What is in the repository

```
server/    mock google-docs-mcp: same 6 tools, schemas and output text, over seeded fixtures; --padding N
tasks/     T1-T3 prompts, expected answers computed from the fixtures, and the checker
bench/     API harness (modes A-C), Claude Code runner (modes D-E), report
results/   raw/*.jsonl, one line per run, and results.md (generated)
test/      npm test: fixtures, checker, server, harness (recorded responses, no API key)
```

**The server** mirrors [`@yeyo11/google-docs-mcp`](https://github.com/yeyo11/google-docs-mcp)
(`list_documents`, `list_comments`, `get_comments_summary`, `get_comment`, `get_document`,
`get_auth_status`), answering from 20 invented documents of an invented team's "Q4 planning" folder:
300 comments with authors, dates, open/resolved status, reply threads, reopened threads, deleted
comments and quoted text. "Today" is fixed at 2026-11-20, so answers never drift. `--padding N`
adds N plausible filler tools (calendar, sheets, gmail, CRM, tickets...) to grow the catalogue,
because with 6 tools the definitions cost little.

**Tasks** (expected answers in [`tasks/expected.json`](tasks/expected.json)):

| Task | What | Shape |
|---|---|---|
| T1 | In every document, which open comments have had no reply for more than 7 days? Group by document, count per author. | 1 + 20 calls, large results, small answer: Code Mode's case |
| T2 | How many open comments does the Budget 2027 document have? | One or two calls: the control, where Code Mode should lose |
| T3 | T2 with `--padding 200` (206 tools) | What tool definitions alone cost |

Every prompt asks the model to end with a JSON block; the checker grades it by exact set and count
match.

**Modes**:

| Mode | Where | What it is |
|---|---|---|
| A. Classic | Claude API, own loop | Every tool result goes through the model |
| B. Classic + tool search | Claude API | `tool_search_tool_bm25_20251119`; every tool `defer_loading: true` except `list_documents` |
| C. Programmatic tool calling | Claude API | `code_execution_20260120` + `allowed_callers` on every tool |
| D. Claude Code, classic | `claude -p` | What most people use daily |
| E. Claude Code, Code Mode | Interactive session with `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`, measured from its transcript | Experimental; does not run under `-p` |

Same model, same effort (`medium`) and same prompt in every mode. Prompt caching (automatic, 5-minute
TTL) is on in modes A-C, as any real agent would use it.

**Per run** the harness records input tokens summed over **every** request (uncached + cache writes
+ cache reads, each also on its own), output tokens, number of model requests, tool calls (direct vs
programmatic), wall time, correct yes/no, and cost in USD from the
[pricing page](https://platform.claude.com/docs/en/about-claude/pricing) (`bench/src/prices.ts`).

## Run it

Node 20+. Modes A-C need a Claude API key in `ANTHROPIC_API_KEY`; modes D-E need Claude Code
v2.1.323 or later, signed in.

```sh
npm install
npm test                       # builds, then checks fixtures, checker, server and harness; free

# Look at the exact request a mode would send, without sending it (no key needed)
npm run bench -- api --dry-run --mode C --task T2

# Debug the harness cheaply on Haiku 5.5, one repetition
npm run bench -- api --model claude-haiku-5-5 --mode A,B,C --task T2 --reps 1 --smoke

# One command per mode (5 repetitions of T1-T3; Sonnet 5.5 by default)
npm run bench -- api --mode A
npm run bench -- api --mode B
npm run bench -- api --mode C
npm run bench -- claude-code --mode D
npm run bench -- session-command --mode E --task T1    # mode E is interactive: see docs/claude-code-code-mode.md
npm run bench -- transcript --latest --mode E --task T1 --rep 1

# Or all API modes interleaved in one run, which is fairer (drift over time hits every mode alike)
npm run bench -- api --mode A,B,C --task T1,T2,T3 --reps 5 --cap 9

npm run report                 # writes results/results.md
```

The API harness keeps a running cost and **stops the whole run** once it reaches `--cap` (9 USD by
default). `--spent` adds what earlier invocations already spent. Other flags: `--model`, `--effort`,
`--no-cache`, `--max-requests`, `--batch`. `npm run bench -- tasks` prints the prompts and answers;
`npm run bench -- tools --padding 200` lists the catalogue.

## Results

_Placeholder: the final runs are not in yet._ The generated table lives in
[`results/results.md`](results/results.md): median (min–max) per task × mode, cold and warm cache in
separate rows. The only run so far is a Claude Code smoke test of mode D on T2, listed there apart
from the results (the mode E smoke run turned out to run without Code Mode and is listed as invalid).

## Caveats

- **Tokens are not money.** Most of what Code Mode saves in a long loop are cache reads, which cost
  5 % of the input price on Sonnet 5.5. A big drop in tokens can be a small drop in dollars; the
  table shows both, and cold and warm cache separately.
- **T2 is there for Code Mode to lose.** One or two small calls do not repay the code execution
  container and the extra turn to write the script. Anthropic's docs say so ("weak fit"); publishing it
  is part of the point.
- **Programmatic tool results are not billed** as input tokens on the Claude API ("Only the final code
  execution result and Claude's response count"). That is the real effect, not an accounting trick,
  but it is why mode C's input can look tiny.
- **Code execution container time is not in the cost.** Each organization gets 1,550 free
  container-hours a month; these runs stay inside it.
- **Tool search is a fair rival, not a strawman.** Mode B solves the definition cost of a large
  catalogue without any code; T3 is where it competes with C.
- **Claude Code's numbers are its own.** `total_cost_usd` is Claude Code's client-side estimate; on a
  subscription nothing is billed per run. Its system prompt is not the API harness's, so compare D
  with E, not D with A.
- **Claude Code Code Mode does not run under `-p`.** The docs require an interactive terminal and a
  one-time opt-in, and under `claude -p` (v2.1.330) the `REPL` tool never appears. The headless runner
  therefore refuses mode E (it stops at Claude Code's init event and exits with code 4), and mode E is
  measured from interactive transcripts with the manual steps in
  [`docs/claude-code-code-mode.md`](docs/claude-code-code-mode.md). A mode E record without a `REPL`
  call is reported as invalid, never as Code Mode.
- **Claude Code isolation.** Runs use `--strict-mcp-config`, `--setting-sources ""` (no user hooks,
  plugins or settings), an empty working folder, and only the mock server's tools (plus `REPL` in E).
  Claude Code may also trim or spill very large MCP results; that is recorded, not hidden.
- **Mock latency is zero.** The real server waits on Google's APIs; every extra round trip would cost
  more wall time there than here, in every mode.
- **One model, one server, three tasks.** Sonnet 5.5 at `medium` effort. Mode C writes Python; mode E
  writes JavaScript. Five repetitions per cell is enough to see a direction, not to settle a decimal.
- **No refusal fallbacks.** A fallback would switch models mid-benchmark, so a refusal ends the run as
  an error.

## License

[MIT](LICENSE) © José Antonio Garrido
