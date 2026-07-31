import { apiGet } from '../client';

export type RotationDegree = 0 | 90 | 180 | 270;
export type ConfiguredRotationDegree = 0 | 90 | 270;

export type RotationPassOutcome =
  | {
    rotationDegrees: ConfiguredRotationDegree;
    status: 'succeeded';
  }
  | {
    rotationDegrees: ConfiguredRotationDegree;
    status: 'failed';
    error: {
      type: string;
      message: string;
    };
  };

export interface RotationProposalCandidate {
  id: string;
  line: -1;
  geometryType: 'baseline' | 'bbox';
  providerId?: string;
  providerTextDirection: 'vertical-lr' | 'vertical-rl';
  rotationEvidence: {
    evidenceContract: 'native-and-source-projected-v2';
    mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones';
    clusterIndex: number;
    supportCount: number;
    sourceRotationsDegrees: RotationDegree[];
    sourcePassStatuses: 'succeeded'[];
    representativeRotationDegrees: RotationDegree;
    representativeProviderOrdinal: number;
    memberProviderIds: string[];
    readingOrderSource: 'unresolved-rotated-proposal';
  };
  baseline?: [number, number][];
  bbox: [number, number, number, number];
  bboxSource?: string;
  geometryProvenance: {
    source: 'machine';
    operation: 'detected';
    parentSegmentIds: [];
  };
  ocrText: '';
  boundary?: Array<{ x: number; y: number }>;
}

export interface RotationGeometryProposalArtifact {
  schemaVersion: 1;
  kind: 'rotation-recovery';
  pageId: string;
  source: {
    primarySourceRevision: number;
    sourceChecksumSha256: string;
    baseGeometryRevision: number;
    baseGeometryChecksumSha256: string;
    baseLineSegmentsChecksumSha256: string;
    image: {
      width: number;
      height: number;
      checksumSha256: string;
    };
  };
  rotationProfile: {
    name: 'sideways-recovery-v1';
    evidenceContract: 'native-and-source-projected-v2';
    rotationsDegrees: [0, 90, 270];
    passOutcomes: [
      RotationPassOutcome,
      RotationPassOutcome,
      RotationPassOutcome,
    ];
    mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones';
    coordinateTransform: 'pil-pixel-centers-to-source-v1';
    selectionSummary: {
      rawInputLineCount: number;
      inputLineCount: number;
      clusterCount: number;
      includedClusterCount: number;
      rejectedClusterCount: number;
      appendedRotatedLineCount: number;
    };
  };
  run: {
    id: string;
  };
  candidates: RotationProposalCandidate[];
}

export interface CurrentRotationGeometryProposal {
  id: string;
  artifactChecksumSha256: string;
  createdBy?: string;
  createdAt: string;
  artifact: RotationGeometryProposalArtifact;
}

export interface CurrentRotationGeometryProposalResponse {
  proposal: CurrentRotationGeometryProposal | null;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isPointTuple(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && isCoordinate(value[0])
    && isCoordinate(value[1]);
}

function isBoundaryPoint(
  value: unknown,
): value is { x: number; y: number } {
  return isRecord(value)
    && isCoordinate(value.x)
    && isCoordinate(value.y);
}

function isRotationPassOutcome(
  value: unknown,
  expectedRotation: ConfiguredRotationDegree,
): value is RotationPassOutcome {
  if (
    !isRecord(value)
    || value.rotationDegrees !== expectedRotation
    || (value.status !== 'succeeded' && value.status !== 'failed')
  ) {
    return false;
  }
  if (value.status === 'succeeded') return true;
  return isRecord(value.error)
    && typeof value.error.type === 'string'
    && value.error.type.length > 0
    && typeof value.error.message === 'string'
    && value.error.message.length > 0;
}

function isRotationEvidence(
  value: unknown,
  succeededRotations: ReadonlySet<number>,
): value is RotationProposalCandidate['rotationEvidence'] {
  if (!isRecord(value)) return false;
  const sourceRotations = value.sourceRotationsDegrees;
  const sourceStatuses = value.sourcePassStatuses;
  const memberProviderIds = value.memberProviderIds;
  if (
    value.evidenceContract !== 'native-and-source-projected-v2'
    || value.mergePolicy !== 'baseline-plus-nonoverlapping-vertical-zones'
    || !isNonNegativeInteger(value.clusterIndex)
    || !isPositiveInteger(value.supportCount)
    || !Array.isArray(sourceRotations)
    || sourceRotations.length === 0
    || !sourceRotations.every((rotation) => (
      (rotation === 0 || rotation === 90 || rotation === 180 || rotation === 270)
      && succeededRotations.has(rotation)
    ))
    || new Set(sourceRotations).size !== sourceRotations.length
    || !Array.isArray(sourceStatuses)
    || sourceStatuses.length !== sourceRotations.length
    || !sourceStatuses.every((status) => status === 'succeeded')
    || (
      value.representativeRotationDegrees !== 90
      && value.representativeRotationDegrees !== 180
      && value.representativeRotationDegrees !== 270
    )
    || !sourceRotations.includes(value.representativeRotationDegrees)
    || !isNonNegativeInteger(value.representativeProviderOrdinal)
    || !Array.isArray(memberProviderIds)
    || memberProviderIds.length === 0
    || !memberProviderIds.every((id) => (
      typeof id === 'string' && id.length > 0
    ))
    || value.readingOrderSource !== 'unresolved-rotated-proposal'
  ) {
    return false;
  }
  return true;
}

function isRotationCandidate(
  value: unknown,
  imageWidth: number,
  imageHeight: number,
  succeededRotations: ReadonlySet<number>,
): value is RotationProposalCandidate {
  if (!isRecord(value)) return false;
  const bbox = value.bbox;
  if (
    typeof value.id !== 'string'
    || !STABLE_ID_PATTERN.test(value.id)
    || value.line !== -1
    || (value.geometryType !== 'baseline' && value.geometryType !== 'bbox')
    || (
      value.providerTextDirection !== 'vertical-lr'
      && value.providerTextDirection !== 'vertical-rl'
    )
    || !isRotationEvidence(value.rotationEvidence, succeededRotations)
    || !Array.isArray(bbox)
    || bbox.length !== 4
    || !bbox.every(isCoordinate)
    || bbox[2] <= bbox[0]
    || bbox[3] <= bbox[1]
    || bbox[2] > imageWidth
    || bbox[3] > imageHeight
    || !isRecord(value.geometryProvenance)
    || value.geometryProvenance.source !== 'machine'
    || value.geometryProvenance.operation !== 'detected'
    || !Array.isArray(value.geometryProvenance.parentSegmentIds)
    || value.geometryProvenance.parentSegmentIds.length !== 0
    || value.ocrText !== ''
  ) {
    return false;
  }

  if (
    value.providerId !== undefined
    && (typeof value.providerId !== 'string' || value.providerId.length === 0)
  ) {
    return false;
  }
  if (
    value.bboxSource !== undefined
    && (typeof value.bboxSource !== 'string' || value.bboxSource.length === 0)
  ) {
    return false;
  }
  if (value.geometryType === 'bbox' && value.baseline !== undefined) {
    return false;
  }
  if (
    value.geometryType === 'baseline'
    && (
      !Array.isArray(value.baseline)
      || value.baseline.length < 2
      || !value.baseline.every(isPointTuple)
      || value.baseline.some(([x, y]) => x > imageWidth || y > imageHeight)
    )
  ) {
    return false;
  }
  if (
    value.boundary !== undefined
    && (
      !Array.isArray(value.boundary)
      || value.boundary.length < 3
      || !value.boundary.every(isBoundaryPoint)
      || value.boundary.some(({ x, y }) => x > imageWidth || y > imageHeight)
    )
  ) {
    return false;
  }
  return true;
}

function requireRotationProposalArtifact(
  value: unknown,
): RotationGeometryProposalArtifact {
  if (!isRecord(value) || !isRecord(value.source)) {
    throw new Error('The rotation proposal artifact was invalid');
  }
  const artifact = value;
  const source = value.source;
  const image = source.image;
  const profile = value.rotationProfile;
  const run = value.run;
  if (
    artifact.schemaVersion !== 1
    || artifact.kind !== 'rotation-recovery'
    || typeof artifact.pageId !== 'string'
    || artifact.pageId.length === 0
    || !isNonNegativeInteger(source.primarySourceRevision)
    || !isSha256(source.sourceChecksumSha256)
    || !isNonNegativeInteger(source.baseGeometryRevision)
    || !isSha256(source.baseGeometryChecksumSha256)
    || !isSha256(source.baseLineSegmentsChecksumSha256)
    || !isRecord(image)
    || !isPositiveInteger(image.width)
    || !isPositiveInteger(image.height)
    || !isSha256(image.checksumSha256)
    || !isRecord(profile)
    || profile.name !== 'sideways-recovery-v1'
    || profile.evidenceContract !== 'native-and-source-projected-v2'
    || !Array.isArray(profile.rotationsDegrees)
    || profile.rotationsDegrees.length !== 3
    || profile.rotationsDegrees[0] !== 0
    || profile.rotationsDegrees[1] !== 90
    || profile.rotationsDegrees[2] !== 270
    || !Array.isArray(profile.passOutcomes)
    || profile.passOutcomes.length !== 3
    || !isRotationPassOutcome(profile.passOutcomes[0], 0)
    || !isRotationPassOutcome(profile.passOutcomes[1], 90)
    || !isRotationPassOutcome(profile.passOutcomes[2], 270)
    || profile.passOutcomes[0].status !== 'succeeded'
    || (
      profile.passOutcomes[1].status !== 'succeeded'
      && profile.passOutcomes[2].status !== 'succeeded'
    )
    || profile.mergePolicy !== 'baseline-plus-nonoverlapping-vertical-zones'
    || profile.coordinateTransform !== 'pil-pixel-centers-to-source-v1'
    || !isRecord(profile.selectionSummary)
    || !isRecord(run)
    || typeof run.id !== 'string'
    || run.id.length === 0
    || !Array.isArray(artifact.candidates)
    || artifact.candidates.length === 0
  ) {
    throw new Error('The rotation proposal artifact was incomplete');
  }

  const summary = profile.selectionSummary;
  if (
    !isNonNegativeInteger(summary.rawInputLineCount)
    || !isNonNegativeInteger(summary.inputLineCount)
    || !isNonNegativeInteger(summary.clusterCount)
    || !isNonNegativeInteger(summary.includedClusterCount)
    || !isNonNegativeInteger(summary.rejectedClusterCount)
    || !isNonNegativeInteger(summary.appendedRotatedLineCount)
    || summary.appendedRotatedLineCount !== artifact.candidates.length
  ) {
    throw new Error('The rotation proposal selection summary was invalid');
  }

  const succeededRotations = new Set(
    profile.passOutcomes
      .filter((outcome) => outcome.status === 'succeeded')
      .map((outcome) => outcome.rotationDegrees),
  );
  if (
    !artifact.candidates.every((candidate) => (
      isRotationCandidate(
        candidate,
        image.width as number,
        image.height as number,
        succeededRotations,
      )
    ))
  ) {
    throw new Error('The rotation proposal candidates were invalid');
  }
  const candidateIds = artifact.candidates.map((candidate) => (
    (candidate as RotationProposalCandidate).id
  ));
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error('The rotation proposal candidate IDs were not unique');
  }
  return artifact as unknown as RotationGeometryProposalArtifact;
}

export function requireCurrentRotationGeometryProposalResponse(
  value: unknown,
): CurrentRotationGeometryProposalResponse {
  if (!isRecord(value) || !Object.hasOwn(value, 'proposal')) {
    throw new Error('The rotation proposal response was invalid');
  }
  if (value.proposal === null) {
    return { proposal: null };
  }
  if (!isRecord(value.proposal)) {
    throw new Error('The rotation proposal response was invalid');
  }
  const proposal = value.proposal;
  if (
    typeof proposal.id !== 'string'
    || proposal.id.length === 0
    || !isSha256(proposal.artifactChecksumSha256)
    || (
      proposal.createdBy !== undefined
      && (
        typeof proposal.createdBy !== 'string'
        || proposal.createdBy.length === 0
      )
    )
    || typeof proposal.createdAt !== 'string'
    || !Number.isFinite(Date.parse(proposal.createdAt))
  ) {
    throw new Error('The rotation proposal metadata was invalid');
  }
  return {
    proposal: {
      id: proposal.id,
      artifactChecksumSha256: proposal.artifactChecksumSha256,
      ...(proposal.createdBy !== undefined
        ? { createdBy: proposal.createdBy as string }
        : {}),
      createdAt: proposal.createdAt,
      artifact: requireRotationProposalArtifact(proposal.artifact),
    },
  };
}

export async function getCurrentRotationGeometryProposal(
  pageId: string,
  signal?: AbortSignal,
): Promise<CurrentRotationGeometryProposalResponse> {
  const response = await apiGet<unknown>(
    `/admin/letters/pages/${pageId}/geometry-proposals/rotation/current`,
    undefined,
    signal,
  );
  return requireCurrentRotationGeometryProposalResponse(response);
}
