import type { GraphData } from '../index/indexer.js';

export class QueryEngine {
  public data: GraphData;
  private adj: Map<string, string[]> = new Map();
  private revAdj: Map<string, string[]> = new Map();

  constructor(data: GraphData) {
    this.data = data;
    this.buildAdj();
  }

  private buildAdj() {
    for (const node of this.data.nodes) {
      if (!this.adj.has(node)) {
        this.adj.set(node, []);
        this.revAdj.set(node, []);
      }
    }
    for (const edge of this.data.edges) {
      if (!this.adj.has(edge.from)) {
        this.adj.set(edge.from, []);
      }
      if (!this.revAdj.has(edge.to)) {
        this.revAdj.set(edge.to, []);
      }
      this.adj.get(edge.from)!.push(edge.to);
      this.revAdj.get(edge.to)!.push(edge.from);
    }
  }

  /**
   * Returns true if there is a path from `fromNode` to `toNode`.
   */
  public reachable(fromNode: string, toNode: string): boolean {
    if (!this.adj.has(fromNode)) return false;

    const visited = new Set<string>();
    const queue: string[] = [fromNode];
    visited.add(fromNode);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === toNode && current !== fromNode) return true;

      const neighbors = this.adj.get(current) || [];
      for (const next of neighbors) {
        if (next === toNode) return true;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    return false;
  }

  /** How many example paths a caller gets. Evidence for a violation needs a
   *  witness, not an enumeration — one path proves the dependency exists. */
  private static readonly MAX_PATHS = 5;

  /** Ceiling on partial paths examined per query. A dense module graph — barrel
   *  files re-exporting each other — has a number of simple paths exponential
   *  in hop count, and a check that hangs is worse than one that under-reports.
   *  Hitting this returns the paths found so far. */
  private static readonly MAX_EXPANSIONS = 50_000;

  /**
   * Up to {@link MAX_PATHS} shortest paths from `fromNode` to `toNode`, none
   * longer than `maxHops` edges.
   *
   * Searched backwards from `toNode` over reverse edges: the forbidden module
   * is the one node known up front, and its in-degree is normally far smaller
   * than the out-degree of every candidate source. Breadth-first, so paths
   * arrive shortest-first and the search stops on the {@link MAX_PATHS}-th
   * rather than enumerating every path and sorting at the end.
   */
  public paths(fromNode: string, toNode: string, maxHops: number = 10): string[][] {
    if (!this.adj.has(fromNode) || !this.revAdj.has(toNode)) return [];

    const results: string[][] = [];
    const queue: string[][] = [[toNode]];
    let expansions = 0;

    while (queue.length > 0) {
      if (results.length >= QueryEngine.MAX_PATHS) break;
      if (expansions++ > QueryEngine.MAX_EXPANSIONS) break;

      const path = queue.shift()!;
      const current = path[path.length - 1]!;

      if (current === fromNode && path.length > 1) {
        // Built backwards from the target, so the caller sees it reversed.
        results.push([...path].reverse());
        continue;
      }

      if (path.length - 1 >= maxHops) continue;

      for (const next of this.revAdj.get(current) ?? []) {
        // A query where source and target are the same node is asking for a
        // cycle; closing the loop back onto it is the answer, not a revisit.
        if (next === fromNode && fromNode === toNode) {
          results.push([...path, next].reverse());
          continue;
        }
        if (path.includes(next)) continue; // simple paths only — no cycling
        queue.push([...path, next]);
      }
    }

    return results;
  }

  /**
   * Returns cycles found within `nodes` scope using Tarjan's SCC.
   */
  public cycles(nodes?: string[]): string[][] {
    const scope = nodes ? new Set(nodes) : new Set(this.data.nodes);
    
    let index = 0;
    const stack: string[] = [];
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const sccs: string[][] = [];

    // Tarjan with an explicit work stack rather than recursion. A dependency
    // chain is as deep as the repository is layered, and the recursive form
    // overflows the call stack somewhere around ten thousand modules — on a
    // real monorepo, which is the case this rule exists for.
    for (const root of scope) {
      if (indices.has(root)) continue;

      const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
      indices.set(root, index);
      lowlink.set(root, index);
      index++;
      stack.push(root);
      onStack.add(root);

      while (work.length > 0) {
        const frame = work[work.length - 1]!;
        const neighbors = this.adj.get(frame.node) ?? [];

        if (frame.next < neighbors.length) {
          const w = neighbors[frame.next]!;
          frame.next++;
          if (!scope.has(w)) continue;

          if (!indices.has(w)) {
            indices.set(w, index);
            lowlink.set(w, index);
            index++;
            stack.push(w);
            onStack.add(w);
            work.push({ node: w, next: 0 });
          } else if (onStack.has(w)) {
            lowlink.set(frame.node, Math.min(lowlink.get(frame.node)!, indices.get(w)!));
          }
          continue;
        }

        // every neighbour visited: close this node
        if (lowlink.get(frame.node) === indices.get(frame.node)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== frame.node);

          if (scc.length > 1) {
            sccs.push(scc);
          } else if (scc.length === 1 && (this.adj.get(scc[0]!) ?? []).includes(scc[0]!)) {
            sccs.push([scc[0]!]);
          }
        }

        work.pop();
        const parent = work[work.length - 1];
        if (parent) {
          lowlink.set(
            parent.node,
            Math.min(lowlink.get(parent.node)!, lowlink.get(frame.node)!),
          );
        }
      }
    }

    const results: string[][] = [];
    for (const scc of sccs) {
      if (scc.length === 1) {
        results.push([scc[0], scc[0]]);
        continue;
      }
      
      const start = scc[0];
      const sccSet = new Set(scc);
      const q: { path: string[] }[] = [{ path: [start] }];
      const visitedPaths = new Set<string>();
      let expansions = 0;

      let found = false;
      // Same ceiling as paths(): the component is known to contain a cycle,
      // and walking one out of a dense component can cost more than saying so.
      while (q.length > 0 && !found && expansions++ <= QueryEngine.MAX_EXPANSIONS) {
        const { path } = q.shift()!;
        const curr = path[path.length - 1];
        
        const nbrs = this.adj.get(curr) || [];
        for (const nxt of nbrs) {
          if (!sccSet.has(nxt)) continue;
          if (nxt === start) {
            results.push([...path, start]);
            found = true;
            break;
          }
          if (!path.includes(nxt)) {
            const p = [...path, nxt];
            const pStr = p.join('|');
            if (!visitedPaths.has(pStr)) {
              visitedPaths.add(pStr);
              q.push({ path: p });
            }
          }
        }
      }
      if (!found) {
        results.push([...scc, start]);
      }
    }

    return results;
  }

  /**
   * Returns all nodes within maxHops distance from the given nodes.
   */
  public neighbors(nodes: string[], maxHops: number = 2): string[] {
    const visited = new Set<string>();
    let currentLevel = new Set<string>(nodes);
    
    for (const node of currentLevel) {
      visited.add(node);
    }

    for (let hop = 0; hop < maxHops; hop++) {
      const nextLevel = new Set<string>();
      
      for (const node of currentLevel) {
        const outNeighbors = this.adj.get(node) || [];
        for (const out of outNeighbors) {
          if (!visited.has(out)) {
            visited.add(out);
            nextLevel.add(out);
          }
        }
        const inNeighbors = this.revAdj.get(node) || [];
        for (const inNode of inNeighbors) {
          if (!visited.has(inNode)) {
            visited.add(inNode);
            nextLevel.add(inNode);
          }
        }
      }
      
      if (nextLevel.size === 0) break;
      currentLevel = nextLevel;
    }

    return Array.from(visited);
  }
}

