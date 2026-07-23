import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JSON_BODY_LIMIT,
  IMAGE_PERF_JSON_BODY_LIMIT,
  isImagePerfPath,
  jsonBodyLimitForPath,
} from '../json-body.js';

describe('json body limits', () => {
  it('gives anonymous image telemetry a dedicated small transport envelope', () => {
    expect(jsonBodyLimitForPath('/images/perf')).toBe(IMAGE_PERF_JSON_BODY_LIMIT);
    expect(jsonBodyLimitForPath('/images/perf/')).toBe(IMAGE_PERF_JSON_BODY_LIMIT);
    expect(jsonBodyLimitForPath('/images/perf///')).toBe(IMAGE_PERF_JSON_BODY_LIMIT);
    expect(isImagePerfPath('/images/perf/')).toBe(true);
    expect(IMAGE_PERF_JSON_BODY_LIMIT).toBe('32kb');
  });

  it('preserves the existing API limit for other JSON routes', () => {
    expect(jsonBodyLimitForPath('/auth/login')).toBe(DEFAULT_JSON_BODY_LIMIT);
    expect(jsonBodyLimitForPath('/admin/letters')).toBe(DEFAULT_JSON_BODY_LIMIT);
  });
});
