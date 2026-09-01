import { describe, it, expect } from 'vitest';
import { QueryEngine } from '../src/query/query.js';
import type { GraphData } from '../src/index/indexer.js';

describe('QueryEngine', () => {
  const makeData = (edges: [string, string][]): GraphData => {
    const nodes = new Set<string>();
    for (const [u, v] of edges) {
      nodes.add(u);
      nodes.add(v);
    }
    return {
      nodes: Array.from(nodes),
      edges: edges.map(([from, to]) => ({ from, to })),
    };
  };

  describe('reachable()', () => {
    const data = makeData([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['X', 'Y'],
    ]);
    const q = new QueryEngine(data);

    it('returns true for direct edges', () => expect(q.reachable('A', 'B')).toBe(true));
    it('returns true for transitive paths', () => expect(q.reachable('A', 'D')).toBe(true));
    it('returns false for disconnected nodes', () => expect(q.reachable('A', 'X')).toBe(false));
    it('returns false for backwards paths', () => expect(q.reachable('C', 'A')).toBe(false));
    it('returns false for unknown nodes', () => expect(q.reachable('Z', 'A')).toBe(false));
    it('returns false if toNode is unknown', () => expect(q.reachable('A', 'Z')).toBe(false));
  });

  describe('paths()', () => {
    const data = makeData([
      ['A', 'B'],
      ['B', 'C'],
      ['A', 'X'],
      ['X', 'C'],
      ['C', 'D'],
      ['Y', 'D'],
    ]);
    const q = new QueryEngine(data);

    it('finds paths with reverse reachability', () => {
      const p = q.paths('A', 'C');
      expect(p).toHaveLength(2);
      expect(p).toContainEqual(['A', 'B', 'C']);
      expect(p).toContainEqual(['A', 'X', 'C']);
    });
    
    it('finds shortest path', () => {
      const data2 = makeData([['A', 'B'], ['B', 'C'], ['A', 'C']]);
      const q2 = new QueryEngine(data2);
      const p = q2.paths('A', 'C');
      expect(p[0]).toEqual(['A', 'C']);
    });

    it('respects maxHops', () => {
      const p = q.paths('A', 'D', 2);
      expect(p).toHaveLength(0);
    });

    it('returns empty for disconnected', () => {
      expect(q.paths('A', 'Y')).toEqual([]);
    });

    it('returns empty for unknown nodes', () => {
      expect(q.paths('A', 'Z')).toEqual([]);
      expect(q.paths('Z', 'A')).toEqual([]);
    });
  });

  describe('cycles()', () => {
    it('finds simple cycles using Tarjan', () => {
      const q = new QueryEngine(makeData([['A', 'B'], ['B', 'C'], ['C', 'A']]));
      const cycles = q.cycles();
      expect(cycles).toHaveLength(1);
      const c = cycles[0];
      expect(c[0]).toEqual(c[c.length - 1]);
      expect(c.length).toBe(4);
    });

    it('handles self-loops', () => {
      const q = new QueryEngine(makeData([['A', 'A']]));
      const cycles = q.cycles();
      expect(cycles).toHaveLength(1);
      expect(cycles[0]).toEqual(['A', 'A']);
    });

    it('finds disjoint cycles', () => {
      const q = new QueryEngine(makeData([
        ['A', 'B'], ['B', 'A'],
        ['X', 'Y'], ['Y', 'Z'], ['Z', 'X']
      ]));
      const cycles = q.cycles();
      expect(cycles).toHaveLength(2);
    });

    it('ignores components without cycles', () => {
      const q = new QueryEngine(makeData([['A', 'B'], ['B', 'C']]));
      expect(q.cycles()).toHaveLength(0);
    });

    it('finds one cycle per SCC', () => {
      const q = new QueryEngine(makeData([
        ['A', 'B'], ['B', 'C'], ['C', 'A'],
        ['A', 'C'], ['C', 'B'], ['B', 'A']
      ]));
      const cycles = q.cycles();
      expect(cycles).toHaveLength(1); 
    });

    it('respects node scope filter', () => {
      const q = new QueryEngine(makeData([['A', 'B'], ['B', 'C'], ['C', 'A']]));
      const cycles = q.cycles(['A', 'C']);
      expect(cycles).toHaveLength(0);
    });
  });

  describe('neighbors()', () => {
    const data = makeData([
      ['A', 'B'],
      ['B', 'C'],
      ['X', 'B'],
      ['C', 'D'],
    ]);
    const q = new QueryEngine(data);

    it('finds neighbors in both directions up to maxHops', () => {
      const n = q.neighbors(['B'], 1);
      expect(n).toContain('B');
      expect(n).toContain('A');
      expect(n).toContain('X');
      expect(n).toContain('C');
      expect(n).not.toContain('D');
    });

    it('finds neighbors up to 2 hops', () => {
      const n = q.neighbors(['B'], 2);
      expect(n).toContain('D');
    });

    it('handles multiple source nodes', () => {
      const n = q.neighbors(['A', 'C'], 1);
      expect(n).toContain('A');
      expect(n).toContain('B');
      expect(n).toContain('C');
      expect(n).toContain('D');
      expect(n).not.toContain('X');
    });

    it('returns only source node if maxHops=0', () => {
      const n = q.neighbors(['B'], 0);
      expect(n).toEqual(['B']);
    });
  });
});

describe('depth and density limits', () => {
  /** A chain long enough that a recursive Tarjan overflows the call stack.
   *  Real monorepos reach this; the engine must answer rather than crash. */
  it('handles a 50k-node chain without overflowing the stack', () => {
    const nodes: string[] = [];
    const edges: { from: string; to: string }[] = [];
    for (let i = 0; i < 50_000; i++) {
      nodes.push(`f${i}`);
      if (i < 49_999) edges.push({ from: `f${i}`, to: `f${i + 1}` });
    }
    const q = new QueryEngine({ nodes, edges });
    expect(q.cycles()).toEqual([]);
    expect(q.reachable('f0', 'f49999')).toBe(true);
  });

  it('still finds a cycle at the end of a long chain', () => {
    const nodes: string[] = [];
    const edges: { from: string; to: string }[] = [];
    for (let i = 0; i < 20_000; i++) {
      nodes.push(`f${i}`);
      if (i < 19_999) edges.push({ from: `f${i}`, to: `f${i + 1}` });
    }
    edges.push({ from: 'f19999', to: 'f19998' });
    const q = new QueryEngine({ nodes, edges });
    expect(q.cycles().length).toBe(1);
  });

  it('returns quickly on a dense graph instead of enumerating every path', () => {
    // 40 nodes, every node pointing at every later node: the number of simple
    // paths from the first to the last is 2^38.
    const nodes = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const edges: { from: string; to: string }[] = [];
    for (let i = 0; i < 40; i++) {
      for (let j = i + 1; j < 40; j++) edges.push({ from: `n${i}`, to: `n${j}` });
    }
    const q = new QueryEngine({ nodes, edges });
    const started = Date.now();
    const found = q.paths('n0', 'n39');
    expect(found.length).toBeLessThanOrEqual(5);
    expect(found[0]).toEqual(['n0', 'n39']);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
