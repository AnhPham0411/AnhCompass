import type { GraphData } from '../index/indexer.js';

export class QueryEngine {
  public data: GraphData;
  private adj: Map<string, string[]> = new Map();

  constructor(data: GraphData) {
    this.data = data;
    this.buildAdj();
  }

  private buildAdj() {
    for (const node of this.data.nodes) {
      if (!this.adj.has(node)) {
        this.adj.set(node, []);
      }
    }
    for (const edge of this.data.edges) {
      if (!this.adj.has(edge.from)) {
        this.adj.set(edge.from, []);
      }
      this.adj.get(edge.from)!.push(edge.to);
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

  /**
   * Returns the shortest path from `fromNode` to `toNode` up to `maxHops`.
   */
  public paths(fromNode: string, toNode: string, maxHops: number = 10): string[][] {
    if (!this.adj.has(fromNode)) return [];
    
    const results: string[][] = [];
    const queue: { path: string[] }[] = [{ path: [fromNode] }];

    while (queue.length > 0) {
      const { path } = queue.shift()!;
      const current = path[path.length - 1];

      if (current === toNode && path.length > 1) {
        results.push(path);
        // Only return shortest paths to avoid combinatorial explosion
        continue;
      }

      if (path.length - 1 >= maxHops) {
        continue;
      }

      const neighbors = this.adj.get(current) || [];
      for (const next of neighbors) {
        if (!path.includes(next)) {
          queue.push({ path: [...path, next] });
        } else if (next === toNode) {
          results.push([...path, next]);
        }
      }
    }

    // Sort by length and return just the shortest ones
    results.sort((a, b) => a.length - b.length);
    return results.slice(0, 5);
  }

  /**
   * Returns all cycles found within `nodes` scope.
   */
  public cycles(nodes?: string[]): string[][] {
    const results: string[][] = [];
    const scope = nodes ? new Set(nodes) : new Set(this.data.nodes);
    
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string) => {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      const neighbors = this.adj.get(node) || [];
      for (const next of neighbors) {
        if (!scope.has(next)) continue;

        if (!visited.has(next)) {
          dfs(next);
        } else if (recStack.has(next)) {
          const cycleStart = path.indexOf(next);
          results.push([...path.slice(cycleStart), next]);
        }
      }

      recStack.delete(node);
      path.pop();
    };

    for (const node of scope) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    // Filter duplicates
    const uniqueCycles = new Map<string, string[]>();
    for (const c of results) {
      const normalized = [...c.slice(0, -1)].sort().join('->');
      if (!uniqueCycles.has(normalized)) {
        uniqueCycles.set(normalized, c);
      }
    }

    return Array.from(uniqueCycles.values());
  }

  /**
   * Returns all nodes within maxHops distance from the given 
odes,
   * searching both forwards (outbound edges) and backwards (inbound edges).
   */
  public neighbors(nodes: string[], maxHops: number = 2): string[] {
    const revAdj = new Map<string, string[]>();
    for (const edge of this.data.edges) {
      if (!revAdj.has(edge.to)) revAdj.set(edge.to, []);
      revAdj.get(edge.to)!.push(edge.from);
    }

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
        const inNeighbors = revAdj.get(node) || [];
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

