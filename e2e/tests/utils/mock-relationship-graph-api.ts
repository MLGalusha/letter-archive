import type { Page } from '@playwright/test';
import { API_BASE_URL } from './test-helpers';

interface MockGraphNode {
  id: string;
  name: string;
  letterCount: number;
}

interface MockGraphEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: string;
  confidence: number;
}

interface MockConnectionPath {
  path: Array<{ id: string; name: string }>;
  edges: Array<{ id: string; type: string }>;
  message?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createMockRelationshipGraphData(): {
  nodes: MockGraphNode[];
  edges: MockGraphEdge[];
} {
  return {
    nodes: [
      { id: 'person-a', name: 'Alice Smith', letterCount: 4 },
      { id: 'person-b', name: 'Bob Baker', letterCount: 3 },
      { id: 'person-c', name: 'Carol Clark', letterCount: 2 },
      { id: 'person-d', name: 'David Dunn', letterCount: 1 },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'person-a',
        target: 'person-b',
        relationshipType: 'friend',
        confidence: 96,
      },
      {
        id: 'edge-2',
        source: 'person-b',
        target: 'person-c',
        relationshipType: 'sibling',
        confidence: 92,
      },
      {
        id: 'edge-3',
        source: 'person-b',
        target: 'person-d',
        relationshipType: 'business-associate',
        confidence: 55,
      },
    ],
  };
}

export function createMockConnectionPaths(): Record<string, MockConnectionPath> {
  return {
    'person-a:person-c': {
      path: [
        { id: 'person-a', name: 'Alice Smith' },
        { id: 'person-b', name: 'Bob Baker' },
        { id: 'person-c', name: 'Carol Clark' },
      ],
      edges: [
        { id: 'edge-1', type: 'friend' },
        { id: 'edge-2', type: 'sibling' },
      ],
    },
    'person-c:person-a': {
      path: [
        { id: 'person-c', name: 'Carol Clark' },
        { id: 'person-b', name: 'Bob Baker' },
        { id: 'person-a', name: 'Alice Smith' },
      ],
      edges: [
        { id: 'edge-2', type: 'sibling' },
        { id: 'edge-1', type: 'friend' },
      ],
    },
  };
}

export async function installMockRelationshipGraphApi(
  page: Page,
  options: {
    graphData?: ReturnType<typeof createMockRelationshipGraphData>;
    collectionGraphData?: ReturnType<typeof createMockRelationshipGraphData>;
    connectionPaths?: Record<string, MockConnectionPath>;
  } = {},
) {
  const graphData = options.graphData ?? createMockRelationshipGraphData();
  const collectionGraphData = options.collectionGraphData ?? graphData;
  const connectionPaths = options.connectionPaths ?? createMockConnectionPaths();
  const pathRequests: string[] = [];

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/collections$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'collection-9',
          collectionCode: '009',
          title: 'Collection 009',
          description: 'Mocked relationship graph collection',
          createdAt: '2025-01-01T00:00:00.000Z',
          letterCount: 4,
        },
      ]),
    });
  });

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/relationships/path/[^/]+/[^/]+$`),
    async (route) => {
      const [, personAId, personBId] = route.request().url().match(
        /\/relationships\/path\/([^/]+)\/([^/]+)$/,
      ) ?? [];
      pathRequests.push(route.request().url());

      const key = `${personAId}:${personBId}`;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          connectionPaths[key] ?? {
            path: [],
            edges: [],
            message: 'No connection found between these people',
          },
        ),
      });
    },
  );

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/relationships/collection/[^/]+$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(collectionGraphData),
      });
    },
  );

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/relationships$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(graphData),
    });
  });

  return {
    pathRequests,
  };
}
