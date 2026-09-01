# Security Policy

## Supported versions

AnhCompass is pre-1.0. Only the latest `0.x` release receives fixes.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/AnhPham0411/AnhCompass/security/advisories/new)
on the repository. Please do not open a public issue for a vulnerability.

Include what you did, what happened, and the version. A first response should arrive
within a week.

## What this tool touches

Worth knowing when assessing risk:

- **It reads your source code.** The deterministic and graph engines run entirely on your
  machine and send nothing anywhere.
- **The semantic engine sends code to a model provider.** Only when an API key is present.
  What it sends: the diff, snippets of files in the intent's scope, and the rule text —
  bounded by a token budget. If that is unacceptable for your codebase, run without a key;
  the deterministic and graph engines are the ones that can block a merge anyway.
- **It writes a cache** to `.anhcompass/cache/` in the repository root. Index data only;
  no credentials. `anhcompass init` adds it to `.gitignore`.
- **API keys come from the environment**, never from a file this tool writes. Error
  messages redact the key before they are raised.
- **The GitHub Action posts a comment** on the pull request it ran against, containing
  rule ids, file paths and short code excerpts from your diff.

## Scope

In scope: anything that leaks credentials or source code, executes attacker-controlled
code from a repository under analysis, or escapes the repository root when reading or
writing files.

Out of scope: a wrong verdict. A false positive or a missed violation is a correctness
bug — please file it as an issue, they matter, but they are not vulnerabilities.
