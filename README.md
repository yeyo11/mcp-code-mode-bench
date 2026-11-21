# mcp-code-mode-bench

How many tokens, model round trips and seconds does an agent spend on the same task, against the
same MCP server, when it calls the tools one by one, and when it writes code that calls them? And
when does Code Mode **not** pay off?

This repository measures it, with a mock MCP server whose answers are known in advance, so every run
is graded by code. Write-up: [Code Mode made twice the requests on my MCP server and cost 44% less](https://josegarrido.dev/en/code-mode-doubles-requests-costs-44-percent-less/?utm_source=github&utm_medium=referral&utm_campaign=code-mode-hace-el-doble-de-peticiones-con-mi-mcp-y-cuesta-un-44-menos).

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
| T2 | How many open comments does the Budget 2027 document have? | One or two calls: the control, where Code Mode should not pay off |
| T3 | T2 with `--padding 200` (206 tools) | What tool definitions alone cost |

Every prompt asks the model to end with a JSON block; the checker grades it by exact set and count
match.

**Modes**:

| Mode | Where | What it is |
|---|---|---|
| A. Classic | Claude API, own loop | Every tool result goes through the model |
| B. Classic + tool search | Claude API | `tool_search_tool_bm25_20251119`; every tool `defer_loading: true` except `list_documents` |
| C. Programmatic tool calling | Claude API | `code_execution_20260120` + `allowed_callers` on every tool |
| D. Claude Code, classic | `claude -p`, or an interactive session measured from its transcript | What most people use daily |
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

Run on 2026-11-21 with Sonnet 5.5 at `medium` effort. Every run below answered correctly. Median
(min–max) per cell; the full generated table, with cold and warm cache in separate rows, is in
[`results/results.md`](results/results.md), and every run is a line in [`results/raw/`](results/raw/).

**Claude API, 5 repetitions per cell, warm cache:**

| Task | A. One by one | B. Tool search | C. Programmatic tool calling |
|---|---|---|---|
| T1: 20 documents, 21 calls | $0.281 · 77k in · 79 s | $0.283 · 80k in · 75 s | **$0.060** · 44k in · 57 s |
| T2: one document | $0.018 · 7 s | **$0.006** · 7 s | $0.012 · 14 s |
| T3: one document, 206 tools | $0.016 · 118k in | **$0.005** · 11k in | $0.029 · 161k in |

**Claude Code 2.1.330, interactive sessions, T1, 3 repetitions** (cost is Claude Code's estimate at API
prices; on a subscription it is quota, not money):

| Mode | Cost | Model requests | Wall time |
|---|---|---|---|
| D. Classic | $0.41 | 4 | 85 s |
| E. Code Mode | **$0.09** | 31 | **38 s** |

What the numbers say:

- **Chained calls whose results only need filtering are Code Mode's case.** T1 is about 4.7× cheaper
  through the API and about 4.5× in Claude Code. Not because there are fewer requests (there are many
  more) but because the 20 results stay in a variable of the script instead of the context, and the
  model writes far fewer output tokens.
- **One call doesn't pay off.** Programmatic tool calling takes twice as long, and tool search is
  cheaper.
- **A large catalogue is not Code Mode's problem to solve.** With 206 tools, every definition is still
  loaded in mode C; tool search (mode B) is about 3× cheaper. Cloudflare's "search, then execute"
  works because it combines both ideas.
- **Tokens are not money.** With a warm cache, the 118k tokens of T3's definitions cost under 2 cents.

## Caveats

- **Tokens are not money.** Most of what Code Mode saves in a long loop are cache reads, which cost
  5 % of the input price on Sonnet 5.5. A big drop in tokens can be a small drop in dollars; the
  table shows both, and cold and warm cache separately.
- **T2 is there for Code Mode not to pay off.** One or two small calls do not repay the code execution
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
  plugins or settings), an empty working folder, and only the mock server's tools, plus `ToolSearch` in
  D (Claude Code defers MCP tools behind it) and `REPL` in E.
  Claude Code may also trim or spill very large MCP results; that is recorded, not hidden.
- **Mock latency is zero.** The real server waits on Google's APIs; every extra round trip would cost
  more wall time there than here, in every mode.
- **One model, one server, three tasks.** Sonnet 5.5 at `medium` effort. Mode C writes Python; mode E
  writes JavaScript. Five repetitions per cell is enough to see a direction, not to settle a decimal.
- **No refusal fallbacks.** A fallback would switch models mid-benchmark, so a refusal ends the run as
  an error.

## License

[MIT](LICENSE) © José Antonio Garrido
