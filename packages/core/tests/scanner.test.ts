import { describe, it, expect } from 'vitest';
import {
  scanSource,
  languageForPath,
  specifierMatchesPackage,
} from '../src/engine/scanner.js';

const jsSpecs = (src: string): string[] =>
  scanSource(src, 'js').imports.map((i) => i.specifier);
const pySpecs = (src: string): string[] =>
  scanSource(src, 'python').imports.map((i) => i.specifier);

describe('languageForPath', () => {
  it('recognizes JS/TS families', () => {
    for (const p of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs']) {
      expect(languageForPath(p)).toBe('js');
    }
  });

  it('recognizes Python', () => {
    expect(languageForPath('a.py')).toBe('python');
  });

  it('returns null for non-code files — text that looks like an import is not one', () => {
    for (const p of ['README.md', 'package.json', 'Dockerfile', 'a.yml']) {
      expect(languageForPath(p)).toBeNull();
    }
  });
});

describe('JS import extraction', () => {
  it('finds every import form', () => {
    expect(jsSpecs("import _ from 'lodash';")).toEqual(['lodash']);
    expect(jsSpecs("import { chunk } from 'lodash';")).toEqual(['lodash']);
    expect(jsSpecs("import * as _ from 'lodash';")).toEqual(['lodash']);
    expect(jsSpecs("import 'lodash';")).toEqual(['lodash']);
    expect(jsSpecs("const _ = require('lodash');")).toEqual(['lodash']);
    expect(jsSpecs("const _ = await import('lodash');")).toEqual(['lodash']);
    expect(jsSpecs("import fp from 'lodash/fp';")).toEqual(['lodash/fp']);
    expect(jsSpecs("import _ = require('lodash');")).toEqual(['lodash']);
  });

  it('finds imports that span lines', () => {
    expect(jsSpecs("import {\n  chunk,\n  debounce,\n} from 'lodash';")).toEqual(['lodash']);
  });

  it('finds re-exports — they create the same dependency edge', () => {
    expect(jsSpecs("export { chunk } from 'lodash';")).toEqual(['lodash']);
    expect(jsSpecs("export * from 'lodash';")).toEqual(['lodash']);
  });

  it('ignores imports inside comments', () => {
    expect(jsSpecs("// import _ from 'lodash';")).toEqual([]);
    expect(jsSpecs("/* import _ from 'lodash'; */")).toEqual([]);
    expect(jsSpecs("/**\n * @example import { chunk } from 'lodash';\n */")).toEqual([]);
    expect(jsSpecs("// const _ = require('lodash');")).toEqual([]);
  });

  it('ignores import text inside string and template literals', () => {
    expect(jsSpecs(`const header = "import _ from 'lodash';";`)).toEqual([]);
    expect(jsSpecs("const snippet = `require('lodash')`;")).toEqual([]);
    expect(jsSpecs(`expect(out).toContain("import _ from 'lodash'");`)).toEqual([]);
  });

  it('still sees code inside a template substitution', () => {
    expect(jsSpecs("const x = `value: ${require('lodash')}`;")).toEqual(['lodash']);
  });

  it('does not confuse an object key named from with a module specifier', () => {
    expect(jsSpecs("export const config = { from: 'lodash' };")).toEqual([]);
  });

  it('collects comments by line for suppression directives', () => {
    const { comments } = scanSource("// anhcompass-disable-next-line no-lodash\nimport _ from 'lodash';", 'js');
    expect(comments.get(1)).toContain('anhcompass-disable-next-line no-lodash');
  });
});

describe('Python import extraction', () => {
  it('finds every import form', () => {
    expect(pySpecs('import requests')).toEqual(['requests']);
    expect(pySpecs('import requests as r')).toEqual(['requests']);
    expect(pySpecs('from requests import Session')).toEqual(['requests']);
    expect(pySpecs('from requests.adapters import HTTPAdapter')).toEqual(['requests.adapters']);
  });

  it('splits comma-separated import lists', () => {
    expect(pySpecs('import json, requests')).toEqual(['json', 'requests']);
  });

  it('ignores comments, strings and docstrings', () => {
    expect(pySpecs('# import requests')).toEqual([]);
    expect(pySpecs('"""\nimport requests\n"""')).toEqual([]);
    expect(pySpecs('code = "import requests"')).toEqual([]);
  });

  it('skips relative imports', () => {
    expect(pySpecs('from . import client')).toEqual([]);
  });
});

describe('specifierMatchesPackage', () => {
  it('matches subpaths but not look-alike packages', () => {
    expect(specifierMatchesPackage('lodash', 'lodash', 'js')).toBe(true);
    expect(specifierMatchesPackage('lodash/fp', 'lodash', 'js')).toBe(true);
    expect(specifierMatchesPackage('lodash-es', 'lodash', 'js')).toBe(false);
  });

  it('matches Python submodules by dot, not by prefix', () => {
    expect(specifierMatchesPackage('requests.adapters', 'requests', 'python')).toBe(true);
    expect(specifierMatchesPackage('requests_mock', 'requests', 'python')).toBe(false);
  });
});
