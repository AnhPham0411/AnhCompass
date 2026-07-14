import matter from 'gray-matter';
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { ZodError } from 'zod';
import { IntentFrontmatterSchema, type Intent } from './schema.js';

export class IntentParseError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly cause: unknown,
  ) {
    const msg =
      cause instanceof ZodError
        ? `Intent frontmatter invalid in ${filePath}:\n${cause.errors.map((e) => `  [${e.path.join('.')}] ${e.message}`).join('\n')}`
        : `Failed to parse intent ${filePath}: ${String(cause)}`;
    super(msg);
    this.name = 'IntentParseError';
  }
}

/** Parse a single intent markdown file. Throws IntentParseError on failure. */
export async function parseIntentFile(filePath: string): Promise<Intent> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new IntentParseError(filePath, err);
  }

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    throw new IntentParseError(filePath, err);
  }

  const result = IntentFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    throw new IntentParseError(filePath, result.error);
  }

  const frontmatter = result.data;

  // id must match filename (without extension)
  const expectedId = basename(filePath, extname(filePath));
  if (frontmatter.id !== expectedId) {
    throw new IntentParseError(
      filePath,
      new Error(`id "${frontmatter.id}" must match filename "${expectedId}"`),
    );
  }

  return { frontmatter, body: parsed.content.trim(), filePath };
}

/** Parse all *.md in a directory (non-recursive). Skips _index.md. */
export async function parseIntentDir(dirPath: string): Promise<{
  intents: Intent[];
  errors: IntentParseError[];
}> {
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch {
    return { intents: [], errors: [] };
  }

  const mdFiles = files.filter((f) => f.endsWith('.md') && f !== '_index.md');

  const results = await Promise.allSettled(
    mdFiles.map((f) => parseIntentFile(join(dirPath, f))),
  );

  const intents: Intent[] = [];
  const errors: IntentParseError[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      intents.push(r.value);
    } else {
      errors.push(r.reason as IntentParseError);
    }
  }

  return { intents, errors };
}
