import { describe, expect, it } from 'vitest';
import { createStartupTiming } from '../startup-timing.js';

describe('startup diagnostics', () => {
  it('does not attribute imports to an uninstrumented entry', () => {
    const timing = createStartupTiming(() => 500);
    timing.markListening();
    expect(timing.snapshot()).toBeNull();
    expect(timing.startReadinessAttempt()('connected')).toBeNull();
  });
  it('measures imports, listening and query separately then stops reporting', () => {
    let now = 100;
    const timing = createStartupTiming(() => now);
    timing.markBootstrap();
    now = 350;
    expect(timing.snapshot()).toEqual({ bootstrapElapsedMs: 250 });
    timing.markListening();
    now = 400;
    const finish = timing.startReadinessAttempt();
    now = 415;
    expect(finish('connected')).toEqual({ bootstrapElapsedMs: 315, listeningElapsedMs: 65,
      readinessAttempt: 1, readinessQueryMs: 15, readinessOutcome: 'connected', firstSuccessfulReadiness: true });
    expect(finish('connected')).toBeNull();
    expect(timing.startReadinessAttempt()('connected')).toBeNull();
  });
  it('reports first failure and eventual success, without every retry', () => {
    let now = 0;
    const timing = createStartupTiming(() => now);
    timing.markBootstrap();
    const first = timing.startReadinessAttempt();
    now = 1000;
    expect(first('disconnected')).toMatchObject({ readinessAttempt: 1, readinessQueryMs: 1000, firstSuccessfulReadiness: false });
    expect(timing.startReadinessAttempt()('unexpected-response')).toBeNull();
    expect(timing.startReadinessAttempt()('connected')).toMatchObject({ readinessAttempt: 3, firstSuccessfulReadiness: true });
  });
  it('handles overlapping attempts without duplicate success logs', () => {
    const timing = createStartupTiming(() => 0);
    timing.markBootstrap();
    const first = timing.startReadinessAttempt();
    const second = timing.startReadinessAttempt();
    expect(second('connected')).toMatchObject({ readinessAttempt: 2, firstSuccessfulReadiness: true });
    expect(first('connected')).toMatchObject({ readinessAttempt: 1, firstSuccessfulReadiness: false });
    expect(timing.startReadinessAttempt()('connected')).toBeNull();
  });
});
