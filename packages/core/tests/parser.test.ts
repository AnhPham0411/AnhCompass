import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseIntentFile, parseIntentDir, IntentParseError } from '../src/intent/parser.js';

const VALID_INTENT = `---
schema_version: 1
id: test-intent
title: Test Intent Title
scope:
  - "src/**"
check: semantic
rule: |
  All services must be pure functions.
severity: warn
status: active
owner: anh
created: 2026-07-14
---

## Context
Some context here.
`;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `anhcompass-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('parseIntentFile', () => {
  it('parses a valid intent file', async () => {
    const filePath = join(tmpDir, 'test-intent.md');
    await writeFile(filePath, VALID_INTENT);

    const intent = await parseIntentFile(filePath);

    expect(intent.frontmatter.id).toBe('test-intent');
    expect(intent.frontmatter.title).toBe('Test Intent Title');
    expect(intent.frontmatter.status).toBe('active');
    expect(intent.frontmatter.check).toBe('semantic');
    expect(intent.body).toContain('Some context here.');
  });

  it('throws IntentParseError when file missing', async () => {
    await expect(parseIntentFile('/nonexistent/path.md')).rejects.toBeInstanceOf(
      IntentParseError,
    );
  });

  it('throws IntentParseError when schema_version is wrong', async () => {
    const bad = VALID_INTENT.replace('schema_version: 1', 'schema_version: 2');
    const filePath = join(tmpDir, 'test-intent.md');
    await writeFile(filePath, bad);

    await expect(parseIntentFile(filePath)).rejects.toBeInstanceOf(IntentParseError);
  });

  it('throws IntentParseError when id has uppercase', async () => {
    const bad = VALID_INTENT.replace('id: test-intent', 'id: TestIntent');
    const filePath = join(tmpDir, 'TestIntent.md');
    await writeFile(filePath, bad);

    await expect(parseIntentFile(filePath)).rejects.toBeInstanceOf(IntentParseError);
  });

  it('throws IntentParseError when id does not match filename', async () => {
    const filePath = join(tmpDir, 'other-name.md');
    await writeFile(filePath, VALID_INTENT); // id=test-intent but file=other-name.md

    await expect(parseIntentFile(filePath)).rejects.toBeInstanceOf(IntentParseError);
  });

  it('throws IntentParseError when required field missing (title)', async () => {
    const bad = VALID_INTENT.replace('title: Test Intent Title\n', '');
    const filePath = join(tmpDir, 'test-intent.md');
    await writeFile(filePath, bad);

    await expect(parseIntentFile(filePath)).rejects.toBeInstanceOf(IntentParseError);
  });

  it('throws IntentParseError when created date wrong format', async () => {
    const bad = VALID_INTENT.replace('created: 2026-07-14', 'created: 14/07/2026');
    const filePath = join(tmpDir, 'test-intent.md');
    await writeFile(filePath, bad);

    await expect(parseIntentFile(filePath)).rejects.toBeInstanceOf(IntentParseError);
  });

  it('throws IntentParseError when status invalid', async () => {
    const bad = VALID_INTENT.replace('status: active', 'status: enabled');
    const filePath = join(tmpDir, 'test-intent.md');
    await writeFile(filePath, bad);

    await expect(parseIntentFile(filePath)).rejects.toBeInstanceOf(IntentParseError);
  });
});

describe('parseIntentDir', () => {
  it('returns empty arrays for non-existent directory', async () => {
    const result = await parseIntentDir('/nonexistent-dir-xyz');
    expect(result.intents).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('parses multiple valid files', async () => {
    const intent1 = VALID_INTENT;
    const intent2 = VALID_INTENT.replace('id: test-intent', 'id: second-intent')
      .replace('title: Test Intent Title', 'title: Second Intent');

    await writeFile(join(tmpDir, 'test-intent.md'), intent1);
    await writeFile(join(tmpDir, 'second-intent.md'), intent2);

    const result = await parseIntentDir(tmpDir);
    expect(result.intents).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('skips _index.md', async () => {
    await writeFile(join(tmpDir, '_index.md'), '# Index\n');
    await writeFile(join(tmpDir, 'test-intent.md'), VALID_INTENT);

    const result = await parseIntentDir(tmpDir);
    expect(result.intents).toHaveLength(1);
  });

  it('collects errors without throwing', async () => {
    await writeFile(join(tmpDir, 'test-intent.md'), VALID_INTENT);
    await writeFile(join(tmpDir, 'bad-intent.md'), 'no frontmatter at all');

    const result = await parseIntentDir(tmpDir);
    expect(result.intents).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(IntentParseError);
  });
});
