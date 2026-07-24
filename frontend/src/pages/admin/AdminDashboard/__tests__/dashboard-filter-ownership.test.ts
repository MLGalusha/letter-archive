import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourcePath = (relativePath: string) => path.resolve(
  process.cwd(),
  'src',
  relativePath,
);

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), 'utf8');
}

async function readSourceIfPresent(relativePath: string) {
  try {
    return await readSource(relativePath);
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return '';
    }
    throw error;
  }
}

function parseSource(source: string, filename: string) {
  return ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function descendants<T extends ts.Node>(
  root: ts.Node,
  isMatch: (node: ts.Node) => node is T,
) {
  const matches: T[] = [];

  const visit = (node: ts.Node) => {
    if (isMatch(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };

  visit(root);
  return matches;
}

function isCallNamed(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === name;
}

function bindingNames(binding: ts.BindingName): string[] {
  if (ts.isIdentifier(binding)) return [binding.text];
  return binding.elements.flatMap((element) => (
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name)
  ));
}

function propertyName(property: ts.ObjectLiteralElementLike) {
  if (ts.isSpreadAssignment(property) || !property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return null;
}

function returnedObjectKeys(source: string) {
  const sourceFile = parseSource(source, 'useDashboardFilters.ts');
  const hook = descendants(
    sourceFile,
    (node): node is ts.FunctionDeclaration => (
      ts.isFunctionDeclaration(node)
      && node.name?.text === 'useDashboardFilters'
    ),
  )[0];

  if (!hook?.body) return null;

  const returned = hook.body.statements.find(ts.isReturnStatement)?.expression;
  if (!returned) return null;

  let object: ts.ObjectLiteralExpression | undefined;
  if (ts.isObjectLiteralExpression(returned)) {
    object = returned;
  } else if (ts.isIdentifier(returned)) {
    object = descendants(
      hook.body,
      (node): node is ts.VariableDeclaration => (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.name.text === returned.text
        && node.initializer !== undefined
        && ts.isObjectLiteralExpression(node.initializer)
      ),
    )[0]?.initializer as ts.ObjectLiteralExpression | undefined;
  }

  return object?.properties
    .map(propertyName)
    .filter((name): name is string => name !== null) ?? null;
}

const committedFilterFields = [
  'collectionFilter',
  'visibilityFilter',
  'searchQuery',
  'yearFilter',
  'monthFilter',
  'dayFilter',
  'dateFromFilter',
  'dateToFilter',
  'transcriptStatusFilters',
  'metadataStatusFilters',
  'extraContentStatusFilters',
  'workflowFilters',
  'flaggedFilter',
  'missingFilters',
  'contentShapeFilters',
] as const;

const legacyRawSetters = [
  'setDateMode',
  'setContentFilterView',
  'setCollectionInput',
  'setVisibilityFilter',
  'setTranscriptStatusFilters',
  'setMetadataStatusFilters',
  'setExtraContentStatusFilters',
  'setWorkflowFilters',
  'setFlaggedFilter',
  'setMissingFilters',
  'setContentShapeFilters',
  'setCollectionFilters',
  'setCollectionFilter',
  'setYearFilter',
  'setMonthFilter',
  'setDayFilter',
  'setDateFromFilter',
  'setDateToFilter',
  'setSearchInput',
  'setSearchQuery',
] as const;

const presentationFiles = [
  'pages/admin/AdminDashboard/DashboardToolbar.tsx',
  'pages/admin/AdminDashboard/DashboardFilterPanel.tsx',
  'pages/admin/AdminDashboard/DashboardDateFilterControl.tsx',
  'pages/admin/AdminDashboard/DashboardSearchField.tsx',
  'pages/admin/AdminDashboard/DashboardCollectionFilterControl.tsx',
  'pages/admin/AdminDashboard/dashboardActiveFilters.ts',
] as const;

describe('dashboard filter ownership', () => {
  it('passes the nested filter query into the committed-query boundary', async () => {
    const source = await readSource('pages/admin/AdminDashboard.tsx');
    const sourceFile = parseSource(source, 'AdminDashboard.tsx');
    const queryCall = descendants(
      sourceFile,
      (node): node is ts.CallExpression => (
        isCallNamed(node, 'createDashboardCommittedQuery')
      ),
    )[0];

    expect(queryCall).toBeDefined();

    const queryArgument = queryCall?.arguments[0];
    expect(
      queryArgument !== undefined
      && ts.isPropertyAccessExpression(queryArgument)
      && queryArgument.name.text === 'query',
    ).toBe(true);

    const queryMemo = descendants(
      sourceFile,
      (node): node is ts.CallExpression => (
        isCallNamed(node, 'useMemo')
        && descendants(
          node,
          (descendant): descendant is ts.CallExpression => (
            descendant === queryCall
          ),
        ).length === 1
      ),
    )[0];
    const queryDependencies = queryMemo?.arguments[1];
    expect(
      queryDependencies !== undefined
      && ts.isArrayLiteralExpression(queryDependencies)
        ? queryDependencies.elements.map((element) => (
          element.getText(sourceFile)
        ))
        : null,
    ).toEqual([
      'dashboardFilters.state.query',
      'sortColumns',
    ]);

    const repeatedFields = descendants(
      sourceFile,
      ts.isVariableDeclaration,
    ).flatMap((declaration) => (
      ts.isObjectBindingPattern(declaration.name)
        ? bindingNames(declaration.name)
        : []
    )).filter((name) => (
      committedFilterFields.includes(name as typeof committedFilterFields[number])
    ));

    expect(repeatedFields).toEqual([]);
  });

  it('exposes grouped filter state, drafts, and named actions', async () => {
    const source = await readSource(
      'pages/admin/AdminDashboard/useDashboardFilters.ts',
    );
    const publicKeys = returnedObjectKeys(source);

    expect(source).not.toMatch(
      /export\s+type\s+\w+\s*=\s*ReturnType\s*<\s*typeof\s+useDashboardFilters\s*>/,
    );
    expect(publicKeys).not.toBeNull();
    expect(publicKeys).toEqual(expect.arrayContaining([
      'state',
      'drafts',
      'actions',
    ]));

    const leakedMembers = publicKeys?.filter((name) => (
      legacyRawSetters.includes(name as typeof legacyRawSetters[number])
      || name === 'initialSortColumns'
      || committedFilterFields.includes(
        name as typeof committedFilterFields[number],
      )
    ));
    expect(leakedMembers).toEqual([]);
  });

  it('keeps raw filter coordination out of presentation files', async () => {
    const sources = await Promise.all(presentationFiles.map(async (filename) => ({
      filename,
      source: await readSourceIfPresent(filename),
    })));

    const inferredContractImports = sources
      .filter(({ source }) => /\bDashboardFilterControls\b/.test(source))
      .map(({ filename }) => `${filename}: DashboardFilterControls`);

    const rawSetterOffenders = sources.flatMap(({ filename, source }) => (
      legacyRawSetters
        .filter((setter) => new RegExp(`\\b${setter}\\b`).test(source))
        .map((setter) => `${filename}: ${setter}`)
    ));

    const collectionControl = sources.find(({ filename }) => (
      filename.endsWith('/DashboardCollectionFilterControl.tsx')
    ))?.source ?? '';
    const repeatedCollectionClear = (
      /collectionFilters\.forEach\s*\(\s*onRemoveCollectionFilter\s*\)/
        .test(collectionControl)
    )
      ? ['pages/admin/AdminDashboard/DashboardCollectionFilterControl.tsx: per-code clear']
      : [];

    expect([
      ...inferredContractImports,
      ...rawSetterOffenders,
      ...repeatedCollectionClear,
    ]).toEqual([]);
  });

  it('keeps sort in its independent route owner', async () => {
    const [routeSource, filterSource] = await Promise.all([
      readSource('pages/admin/AdminDashboard.tsx'),
      readSource('pages/admin/AdminDashboard/useDashboardFilters.ts'),
    ]);
    const route = parseSource(routeSource, 'AdminDashboard.tsx');
    const sortOwner = descendants(
      route,
      (node): node is ts.CallExpression => isCallNamed(node, 'useDashboardSort'),
    )[0];
    const queryCall = descendants(
      route,
      (node): node is ts.CallExpression => (
        isCallNamed(node, 'createDashboardCommittedQuery')
      ),
    )[0];

    expect(sortOwner).toBeDefined();
    expect(queryCall?.arguments).toHaveLength(2);
    expect(queryCall?.arguments[1]?.getText(route)).toMatch(/sort/i);
    expect(filterSource).not.toMatch(/\binitialSortColumns\b/);
  });
});
