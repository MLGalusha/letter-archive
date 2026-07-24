import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const sourceRoot = fileURLToPath(root);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), 'utf8');
}

async function productionTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return productionTypeScriptFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [absolutePath] : [];
  }));
  return nested.flat();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectionTableBindings(contents: string): Set<string> {
  const bindings = new Set<string>();
  const namedImports =
    /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*\/db\/(?:index|schema)\.js['"]/g;
  for (const match of contents.matchAll(namedImports)) {
    for (const imported of (match[1] ?? '').split(',')) {
      const collectionImport = imported
        .trim()
        .replace(/^type\s+/, '')
        .match(/^collections(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (collectionImport) {
        bindings.add(collectionImport[1] ?? 'collections');
      }
    }
  }

  const namespaceImports =
    /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]*\/db\/(?:index|schema)\.js['"]/g;
  for (const match of contents.matchAll(namespaceImports)) {
    bindings.add(`${match[1]}.collections`);
  }

  let foundAlias = true;
  while (foundAlias) {
    foundAlias = false;
    for (const binding of [...bindings]) {
      const escaped = escapeRegExp(binding);
      const aliases = new RegExp(
        `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:alias\\(\\s*)?${escaped}\\b`,
        'g',
      );
      for (const match of contents.matchAll(aliases)) {
        const alias = match[1];
        if (alias && !bindings.has(alias)) {
          bindings.add(alias);
          foundAlias = true;
        }
      }
    }
  }
  return bindings;
}

function writesCollections(contents: string): boolean {
  if (/\bUPDATE\s+(?:(?:"?public"?)\.)?"?collections"?\b/i.test(contents)) {
    return true;
  }

  for (const binding of collectionTableBindings(contents)) {
    const escaped = escapeRegExp(binding);
    if (
      new RegExp(`\\.update\\(\\s*${escaped}\\s*\\)`).test(contents)
      || new RegExp(
        `\\bUPDATE\\s+\\$\\{\\s*${escaped}\\s*\\}`,
        'i',
      ).test(contents)
    ) {
      return true;
    }
  }
  return false;
}

function exportedFunction(contents: string, name: string): string {
  const start = contents.indexOf(`export async function ${name}`);
  if (start === -1) {
    throw new Error(`Could not find exported function ${name}`);
  }
  const next = contents.indexOf('\nexport async function ', start + 1);
  return contents.slice(start, next === -1 ? contents.length : next);
}

describe('collection profile mutation ownership', () => {
  it('keeps start-here resolution read-only for admin and public GET callers', async () => {
    const [collectionService, publicRoutes] = await Promise.all([
      source('services/collections.ts'),
      source('routes/collections.ts'),
    ]);
    const resolver = exportedFunction(
      collectionService,
      'resolveCollectionStartHere',
    );

    expect(resolver).toContain('pickFeaturedLetter');
    expect(resolver).toContain('resolveRepresentativeLetterId');
    expect(resolver).not.toMatch(/\bdb\b/);
    expect(resolver).not.toContain('.update(');
    expect(publicRoutes).not.toMatch(/db\s*\.\s*update\s*\(\s*collections\s*\)/);
  });

  it('keeps profile transitions behind one narrow mutation service', async () => {
    const [adminRoutes, profileMutations] = await Promise.all([
      source('routes/admin/collections.ts'),
      source('services/collection-profile-mutations.ts'),
    ]);

    expect(adminRoutes).toContain('updateCollectionSourceMetadata({');
    expect(adminRoutes).toContain('storeGeneratedCollectionProfile({');
    expect(adminRoutes).toContain('updateCollectionProfile({');
    expect(adminRoutes).not.toMatch(/\.update\(\s*collections\s*\)/);
    expect(profileMutations).toContain(
      'eq(collections.profileRevision, input.expectedProfileRevision)',
    );
    expect(profileMutations).toContain(
      'compute_collection_profile_source_fingerprint(',
    );
    expect(profileMutations).toContain(
      'profileRevision: sql<number>',
    );
  });

  it('permits only the profile owner to write collections through aliases or raw SQL', async () => {
    const writers: string[] = [];
    for (const absolutePath of await productionTypeScriptFiles(sourceRoot)) {
      const contents = await readFile(absolutePath, 'utf8');
      if (writesCollections(contents)) {
        writers.push(path.relative(sourceRoot, absolutePath));
      }
    }

    expect(writers.sort()).toEqual([
      'services/collection-profile-mutations.ts',
    ]);
  });

  it('recognizes collection writes hidden behind supported aliases and SQL forms', () => {
    expect(writesCollections(`
      import { collections as collectionTable } from '../db/schema.js';
      database.update(collectionTable).set({ profileStatus: 'VERIFIED' });
    `)).toBe(true);
    expect(writesCollections(`
      import { collections } from '../db/index.js';
      const target = alias(collections, 'target');
      database.update(target).set({ profileRevision: 2 });
    `)).toBe(true);
    expect(writesCollections(`
      await database.execute(sql\`
        UPDATE "public"."collections" SET profile_status = 'EDITED'
      \`);
    `)).toBe(true);
    expect(writesCollections(`
      import { collections } from '../db/index.js';
      database.select().from(collections);
    `)).toBe(false);
  });

  it('keeps imports of the profile mutation capability explicit', async () => {
    const importers: string[] = [];
    for (const absolutePath of await productionTypeScriptFiles(sourceRoot)) {
      const contents = await readFile(absolutePath, 'utf8');
      if (
        /from\s*['"][^'"]*collection-profile-mutations\.js['"]/.test(contents)
      ) {
        importers.push(path.relative(sourceRoot, absolutePath));
      }
    }

    expect(importers.sort()).toEqual([
      'routes/admin/collections.ts',
      'services/collection-editor-mutation.ts',
      'services/letter/correspondence-deletion.ts',
      'services/letter/page-source-invalidation.ts',
      'services/letter/publication-mutations.ts',
    ]);
  });

  it('keeps the collection editor and legacy rename route behind one transaction owner', async () => {
    const [adminRoutes, editorMutation] = await Promise.all([
      source('routes/admin/collections.ts'),
      source('services/collection-editor-mutation.ts'),
    ]);

    expect(adminRoutes).toContain("router.put('/:code/editor'");
    expect(adminRoutes).toContain("router.patch('/:code/correspondents'");
    expect(
      adminRoutes.match(/\bapplyCollectionEditorMutation\s*\(/g),
    ).toHaveLength(2);
    expect(adminRoutes).not.toContain('propagateName(');
    expect(adminRoutes).toContain(
      'identityFingerprint: collectionIdentityFingerprint(allLetters)',
    );
    expect(editorMutation).toContain('database.transaction');
    expect(editorMutation).toContain('input.expectedIdentityFingerprint');
    expect(editorMutation).toContain('database: tx');
    expect(editorMutation).toContain('commitAtomicCollectionEditorProfile({');
    expect(editorMutation).not.toMatch(/\.update\(\s*collections\s*\)/);
    expect(editorMutation).toMatch(
      /\.from\(collections\)[\s\S]*?\.for\('update'\)[\s\S]*?\.from\(letters\)[\s\S]*?\.orderBy\(asc\(letters\.id\)\)[\s\S]*?\.for\('update'\)/,
    );
  });
});
