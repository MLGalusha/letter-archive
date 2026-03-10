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
  } = {},
) {
  await page.addInitScript(() => {
    sessionStorage.setItem('adminAuth', 'true');
  });

  const graphApi = await installMockRelationshipGraphApi(page, {
    graphData: options.graphData,
  });
  const adminRelationships = options.adminRelationships ?? createMockAdminRelationships();

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/admin/relationships$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(adminRelationships),
    });
  });

  return graphApi;
}
