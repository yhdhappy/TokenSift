# Token Sift

[![npm version](https://img.shields.io/npm/v/token-sift)](https://www.npmjs.com/package/token-sift)
[![CI](https://img.shields.io/github/actions/workflow/status/yhdhappy/TokenSift/ci.yml?branch=main)](https://github.com/yhdhappy/TokenSift/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/token-sift)](https://www.npmjs.com/package/token-sift)
[![license](https://img.shields.io/npm/l/token-sift)](./LICENSE)

Token Sift is a local command-line tool and library for finding avoidable token use in prompts, message arrays, and tool schemas.

**Token Sift is a separate project based on `ritenv/tokensift` (MIT).** It uses the new `token-sift` package and command name, and keeps its configuration and local data separate from the original project in `token-sift.config.json` and `.token-sift/`.

Analysis runs locally. Only the price-refresh and calibration commands use the network, and only when you explicitly run them. No code or prompts are ever uploaded.

## Install

```sh
npm install --global token-sift
```

Or add it to a project:

```sh
npm install token-sift
```

## Quick start

Analyze a prompt file:

```sh
token-sift prompts/support-ticket.md --model gpt-4o
```

Or send a prompt through standard input:

```sh
printf 'Summarize this incident: request 550e8400-e29b-41d4-a716-446655440000 failed.' \
  | token-sift --stdin --model gpt-4o
```

Token Sift reports findings with the affected text, severity, token counts, suggested changes, and a confidence label. Findings for Claude models are estimates; Token Sift does not present Claude token counts as exact.

Use the library from JavaScript or TypeScript:

```ts
import { analyze } from "token-sift";

const report = analyze("Repeated instruction. Repeated instruction.", {
  model: "gpt-4o",
});

console.log(report.findings);
```

## Commands

Initialize project settings and optional integration snippets:

```sh
token-sift init --model gpt-4o
```

This creates `token-sift.config.json` and reference files under `.token-sift/`. The configuration is discovered automatically by other commands. Existing files are preserved unless `--force` is supplied.

Analyze files, globs, or standard input. Use `--write` to apply available safe fixes, or `--format json` to export structured results:

```sh
token-sift "prompts/**/*.md" --model gpt-4o --format json
token-sift prompts/support-ticket.md --model gpt-4o --write
```

Create and enforce a token baseline and budget in CI:

```sh
token-sift prompts/*.md --model gpt-4o --update-baseline
token-sift budget init prompts/*.md --model gpt-4o
token-sift check prompts/*.md --model gpt-4o
```

`check` uses baseline and budget files in `.token-sift/` when present. The default configuration is `token-sift.config.json`; command-line options override values from that file.

The commands that refresh model data or calibrate Claude estimates are explicit opt-ins:

```sh
token-sift pricing update
token-sift calibrate anthropic init
token-sift calibrate anthropic run --model claude-sonnet-4-5
```

Calibration uses the samples you provide and an Anthropic token-counting endpoint. The resulting Claude counts remain estimates. The refresh and calibration commands are the only commands that use the network.

Run `token-sift --help` for the complete command and option list.

## Rules

Token Sift includes 20 built-in prompt-analysis rules for common prompt and payload inefficiencies, including repeated text, oversized identifiers, verbose JSON, duplicated message content, unhelpful filler, dynamic data, and inefficient tabular structures, plus 2 CI gate rules (`budget-exceeded`, `baseline-regression`). Rules can be selected or assigned a severity in `token-sift.config.json` or with `--rules`.

Findings that support safe automatic fixes include a fix description. Review the result before using `--write` on important files.

## Confidence

Counts for supported OpenAI models use their corresponding tokenizer. Claude has no public tokenizer vocabulary in this tool; its counts and derived figures are estimates based on calibration data. Every Claude finding is labeled `estimate`, and no Claude count is described as exact.

## Privacy

Analysis runs locally. Only the price-refresh and calibration commands use the network, and only when you explicitly run them. No code or prompts are ever uploaded.

## License and source

Based on ritenv/tokensift (MIT). Token Sift changes the project name and executable to `token-sift`, and isolates configuration and local data as `token-sift.config.json` and `.token-sift/`. See [LICENSE](./LICENSE), [LICENSE-THIRD-PARTY.md](./LICENSE-THIRD-PARTY.md), and [DESIGN.md](./DESIGN.md).
