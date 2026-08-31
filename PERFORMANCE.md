# Performance

Measured 2026-09-01 on the engines currently shipped: the lexical scanner plus the
TypeScript import graph. The earlier figures in this file measured the regex matcher
that has since been replaced, and did not exercise the graph engine at all — they are
superseded, not merely updated.

## Method

Synthetic repositories, because the shape has to be controlled: a dependency chain
across every TypeScript module with periodic cross edges (so the graph has real depth
rather than a star), roughly 1% of modules depending on a third-party package, and a
parallel set of Python modules. Two deterministic intents are active, one targeting a
JS package and one a Python package. A baseline commit is made, then files are modified
and two new violating files are added untracked.

Single run per configuration on Windows 11, Node 20. Numbers are wall clock for the
whole `anhcompass check` process, including Node startup and `git diff`.

## Results

| Repository | Files in diff | Cold | Graph cache warm | Fully warm |
|---|---|---|---|---|
| 2,500 files (2,000 ts + 500 py) | 253 | 2.8s | — | 1.2s |
| 12,000 files (10,000 ts + 2,000 py) | 1,003 | 7.0s | 3.6s | 1.8s |

Both violations — one TypeScript, one Python — were reported in every configuration.

### Where the cold time goes, at 12,000 files

| Stage | Cost |
|---|---|
| Node startup, `git diff`, diff parse, intent load | ≈ 1.8s |
| Lexical scan of 1,003 changed files + graph queries | ≈ 1.8s |
| TypeScript AST parse of 10,000 modules (first run only) | ≈ 3.2s |

The graph index is cached on disk keyed by file mtime (`.anhcompass/cache/graph.json`,
1.1 MB at this size), so the 3.2s is paid once and then only for files that changed.
Verdicts are cached separately, which is what takes the second run to 1.8s.

## Reading these numbers

The cost is dominated by two things that scale differently. The lexical scan is linear
in the size of the diff and indifferent to repository size. The graph index is linear in
repository size and indifferent to the diff — but it is cached, so in the steady state a
developer pays it only for files they touched.

The graph query itself was not a bottleneck at this size, though it is the part with the
worst asymptotics: for a `no-import` rule it walks every source node matching `from`
against every node matching `to`. Here that was roughly 10,000 breadth-first searches and
it stayed inside the ~1.8s check budget, but a rule whose `to` pattern matches many nodes
would multiply that. If a future rule set makes this hurt, the fix is a reverse
reachability walk from the forbidden nodes rather than a search per source node.

## Caveats

These are synthetic repositories on one machine. Real codebases have deeper directory
trees, larger files, and more third-party edges. Treat the shape of the curve as the
finding — diff-linear lexical work, repo-linear cacheable indexing — rather than the
absolute seconds.
