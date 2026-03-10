import type { Page } from '@playwright/test';
import { API_BASE_URL } from './test-helpers';
import {
  createMockRelationshipGraphData,
  installMockRelationshipGraphApi,
} from './mock-relationship-graph-api';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createMockAdminRelationships() {
  return [
    {
      id: 'rel-1',
      personAId: 'person-a',
      personBId: 'person-b',
      personAName: 'Alice Smith',
      personBName: 'Bob Baker',
      relationshipType: 'friend',
      notes: 'Family friends in Boston',
      confidence: 96,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    },
    {
      id: 'rel-2',
      personAId: 'person-b',
      personBId: 'person-c',
      personAName: 'Bob Baker',
      personBName: 'Carol Clark',
      relationshipType: 'sibling',
      notes: 'Shared parents',
      confidence: 92,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    },
    {
      id: 'rel-3',
      personAId: 'person-b',
      personBId: 'person-d',
      personAName: 'Bob Baker',
      personBName: 'David Dunn',
      relationshipType: 'business-associate',
      notes: 'Factory work',
      confidence: 55,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    },
  ];
}

export async function installMockAdminRelationshipsApi(
  page: Page,
  options: {
    graphData?: ReturnType<typeof createMockRelationshipGraphData>;
    adminRelationships?: ReturnType<typeof createMockAdminRelationships>;
    deleteError?: { message: string; requestId: string };
  } = {},
) {
  await page.addInitScript(() => {
    sessionStorage.setItem('adminAuth', 'true');
  });

  const graphApi = await installMockRelationshipGraphApi(page, {
    graphData: options.graphData,
  });
  const graphData = options.graphData ?? createMockRelationshipGraphData();
  const adminRelationships = [...(options.adminRelationships ?? createMockAdminRelationships())];
  const searchRequests: string[] = [];
  const createRequests: Array<{
    personAId: string;
    personBId: string;
    relationshipType: string;
    confidence?: number;
    notes?: string;
  }> = [];
  const deleteRequests: string[] = [];
  const nodeMap = new Map(graphData.nodes.map((node) => [node.id, node]));

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/entities/persons/search(?:\\?.*)?$`),
    async (route) => {
      const url = new URL(route.request().url());
      const query = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
      searchRequests.push(route.request().url());

      const matches = graphData.nodes
        .filter((node) => node.name.toLowerCase().includes(query))
        .map((node) => ({
          entityId: node.id,
          canonicalName: node.name,
          matchedOn: 'canonical_name',
          similarity: 100,
        }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ matches }),
      });
    },
  );

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/admin/relationships$`), async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        personAId: string;
        personBId: string;
        relationshipType: string;
        confidence?: number;
        notes?: string;
      };
      createRequests.push(body);

      const nextRelationship = {
        id: `rel-${adminRelationships.length + 1}`,
        personAId: body.personAId,
        personBId: body.personBId,
        personAName: nodeMap.get(body.personAId)?.name ?? body.personAId,
        personBName: nodeMap.get(body.personBId)?.name ?? body.personBId,
        relationshipType: body.relationshipType,
        confidence: body.confidence ?? 100,
        notes: body.notes,
        createdAt: '2025-01-03T00:00:00.000Z',
        updatedAt: '2025-01-03T00:00:00.000Z',
      };

      adminRelationships.unshift(nextRelationship);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(nextRelationship),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(adminRelationships),
    });
  });

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/relationships/[^/]+$`),
    async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback();
        return;
      }

      deleteRequests.push(route.request().url());

      if (options.deleteError) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          headers: {
            'x-request-id': options.deleteError.requestId,
          },
          body: JSON.stringify({
            error: options.deleteError.message,
            requestId: options.deleteError.requestId,
          }),
        });
        return;
      }

      const relationshipId = route.request().url().split('/').at(-1);
      const index = adminRelationships.findIndex((relationship) => relationship.id === relationshipId);
      if (index >= 0) {
        adminRelationships.splice(index, 1);
      }

      await route.fulfill({
        status: 204,
        body: '',
      });
    },
  );

  return {
    ...graphApi,
    adminRelationships,
    searchRequests,
    createRequests,
    deleteRequests,
  };
}
