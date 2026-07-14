import type { Intent } from '../intent/schema.js';

export interface ManifestEntry {
  id: string;
  title: string;
  status: string;
  check: string;
  scope: string[];
  filePath: string;
  anchorCount: number;
}

export interface Manifest {
  generatedAt: string;
  intentCount: number;
  entries: ManifestEntry[];
}

/** Build manifest.json content from parsed intents */
export function buildManifest(intents: Intent[]): Manifest {
  return {
    generatedAt: new Date().toISOString(),
    intentCount: intents.length,
    entries: intents.map((i) => ({
      id: i.frontmatter.id,
      title: i.frontmatter.title,
      status: i.frontmatter.status,
      check: i.frontmatter.check,
      scope: i.frontmatter.scope,
      filePath: i.filePath,
      anchorCount: i.frontmatter.anchors?.length ?? 0,
    })),
  };
}
