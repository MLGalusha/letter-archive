export interface DetectLinesCliOptions {
  url: string;
  email: string;
  password: string;
  debug: boolean;
  dryRun: boolean;
  rotationsDegrees?: DetectLinesRotationDegrees;
  limit?: number;
  pageId?: string;
}

export const ROTATED_REGION_RECOVERY_PROFILE = [0, 90, 270] as const;

export type DetectLinesRotationDegrees =
  typeof ROTATED_REGION_RECOVERY_PROFILE;

const valueFlags = new Set([
  'url',
  'email',
  'password',
  'limit',
  'page-id',
  'rotations',
]);

const booleanFlags = new Set([
  'debug',
  'dry-run',
]);

function parseRotations(value: string): DetectLinesRotationDegrees {
  const rotations = value.split(',').map((part) => Number(part.trim()));
  const matchesSupportedProfile = (
    rotations.length === ROTATED_REGION_RECOVERY_PROFILE.length
    && rotations.every(
      (rotation, index) => rotation === ROTATED_REGION_RECOVERY_PROFILE[index],
    )
  );
  if (!matchesSupportedProfile) {
    throw new Error(
      '--rotations must be exactly 0,90,270 in that order '
      + '(180 and custom profiles are not supported)',
    );
  }
  return ROTATED_REGION_RECOVERY_PROFILE;
}

export function parseDetectLinesCliOptions(
  argv: string[],
  env: NodeJS.ProcessEnv,
): DetectLinesCliOptions {
  const values: Record<string, string> = {};
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${argument}`);
    }

    const name = argument.slice(2);
    if (booleanFlags.has(name)) {
      booleans.add(name);
      continue;
    }
    if (!valueFlags.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Option --${name} requires a value`);
    }
    values[name] = value;
    index += 1;
  }

  let limit: number | undefined;
  if (values.limit !== undefined) {
    limit = Number(values.limit);
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('--limit must be a positive integer');
    }
  }

  const pageId = values['page-id']?.trim();
  if (values['page-id'] !== undefined && !pageId) {
    throw new Error('--page-id must not be empty');
  }

  return {
    url: (values.url || env.REMOTE_URL || '').replace(/\/+$/, ''),
    email: values.email || env.ADMIN_EMAIL || '',
    password: values.password || env.ADMIN_PASSWORD || '',
    debug: booleans.has('debug'),
    dryRun: booleans.has('dry-run'),
    ...(values.rotations !== undefined
      ? { rotationsDegrees: parseRotations(values.rotations) }
      : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(pageId ? { pageId } : {}),
  };
}

export function isUnboundedDetectionRun(
  options: Pick<DetectLinesCliOptions, 'limit' | 'pageId'>,
): boolean {
  return options.limit === undefined && options.pageId === undefined;
}
