import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const servicePath = path.resolve(
  process.cwd(),
  'src/services/letter/correspondence-deletion.ts',
);
const routePath = path.resolve(
  process.cwd(),
  'src/routes/admin/letters/content.ts',
);

describe('correspondence deletion ownership', () => {
  it('locks the complete group before checking its shared source fence', async () => {
    const source = await readFile(servicePath, 'utf8');
    const lock = source.indexOf('lockCorrespondenceGroupByLetterId(');
    const fence = source.indexOf('group.members.some(');
    const pageSnapshot = source.indexOf('const pages = await tx');
    const deletion = source.indexOf('.delete(letters)');

    expect(lock).toBeGreaterThan(-1);
    expect(fence).toBeGreaterThan(lock);
    expect(pageSnapshot).toBeGreaterThan(fence);
    expect(deletion).toBeGreaterThan(pageSnapshot);
    expect(source.slice(fence, pageSnapshot)).toContain(
      'sourceRevisionChanged(',
    );
  });

  it('requires the caller source revision and delegates deletion once', async () => {
    const source = await readFile(routePath, 'utf8');
    const routeStart = source.indexOf("router.delete('/:letterId'");
    const routeEnd = source.indexOf(
      "router.patch('/pages/:pageId/line-segments'",
      routeStart,
    );
    const route = source.slice(routeStart, routeEnd);

    expect(route).toContain('requirePrimarySourceRevision(');
    expect(route).toContain(
      'deleteCorrespondenceGroup(\n      letterId,\n      primarySourceRevision,',
    );
    expect(route.match(/deleteCorrespondenceGroup\(/g)).toHaveLength(1);
  });
});
