import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculateOpenAiCost,
  OpenAiBudgetGuard,
  openAiBudgetPolicySchema,
} from '../openai-budget.js';

const policy = openAiBudgetPolicySchema.parse({
  schemaVersion: 1,
  authorizedUsd: 20,
  safetyReserveUsd: 2,
  pricingCapturedAt: '2026-07-29',
  pricingSource: 'https://developers.openai.com/api/docs/pricing',
  longContextThresholdTokens: 272_000,
  longContextInputMultiplier: 2,
  longContextOutputMultiplier: 1.5,
  models: {
    'gpt-5.6-sol': {
      inputUsdPerMillion: 5,
      cachedInputUsdPerMillion: 0.5,
      cacheWriteUsdPerMillion: 6.25,
      outputUsdPerMillion: 30,
    },
  },
});

async function makeGuard() {
  const directory = await mkdtemp(join(tmpdir(), 'letter-archive-budget-'));
  const policyPath = join(directory, 'policy.json');
  const ledgerPath = join(directory, 'ledger.json');
  await writeFile(policyPath, JSON.stringify(policy), 'utf8');
  return {
    guard: new OpenAiBudgetGuard(policyPath, ledgerPath),
    ledgerPath,
  };
}

describe('OpenAI experiment budget guard', () => {
  it('calculates cached, cache-write, output, and reasoning-inclusive cost', () => {
    expect(calculateOpenAiCost(policy, 'gpt-5.6-sol', {
      inputTokens: 100_000,
      cachedInputTokens: 20_000,
      cacheWriteInputTokens: 10_000,
      outputTokens: 10_000,
      reasoningOutputTokens: 5_000,
    })).toBe(0.7225);
  });

  it('reserves worst-case cost before a call and reconciles actual usage', async () => {
    const { guard, ledgerPath } = await makeGuard();
    const reservation = await guard.reserve({
      experiment: 'transcription-smoke',
      model: 'gpt-5.6-sol',
      maximumInputTokens: 20_000,
      maximumOutputTokens: 4_000,
    });
    expect(reservation.reservedUsd).toBe(0.245);
    await guard.markDispatched({ reservationId: reservation.id });

    await guard.settle({
      reservationId: reservation.id,
      responseId: 'resp_test',
      usage: {
        inputTokens: 10_000,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 1_000,
        reasoningOutputTokens: 200,
      },
    });

    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    expect(ledger).toMatchObject({
      authorizedUsd: 20,
      safetyReserveUsd: 2,
      usableUsd: 18,
      spentUsd: 0.08,
      openReservedUsd: 0,
    });
    expect(ledger.calls[0]).toMatchObject({
      status: 'settled',
      actualUsd: 0.08,
      responseId: 'resp_test',
    });
  });

  it('reserves the most expensive possible input token category', async () => {
    const { guard } = await makeGuard();
    const reservation = await guard.reserve({
      experiment: 'cache-write-worst-case',
      model: 'gpt-5.6-sol',
      maximumInputTokens: 20_000,
      maximumOutputTokens: 4_000,
    });
    await guard.markDispatched({ reservationId: reservation.id });

    await expect(guard.settle({
      reservationId: reservation.id,
      responseId: 'resp_cache_write',
      usage: {
        inputTokens: 20_000,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 20_000,
        outputTokens: 4_000,
        reasoningOutputTokens: 0,
      },
    })).resolves.toMatchObject({
      reservedUsd: 0.245,
      actualUsd: 0.245,
    });
  });

  it('counts open reservations and refuses a call that could cross the cap', async () => {
    const { guard } = await makeGuard();
    await guard.reserve({
      experiment: 'large-first-call',
      model: 'gpt-5.6-sol',
      maximumInputTokens: 500_000,
      maximumOutputTokens: 128_000,
    });

    await expect(guard.reserve({
      experiment: 'would-cross-cap',
      model: 'gpt-5.6-sol',
      maximumInputTokens: 500_000,
      maximumOutputTokens: 128_000,
    })).rejects.toThrow('budget guard refused');
  });

  it('rejects malformed reservations before they can corrupt the ledger', async () => {
    const { guard } = await makeGuard();

    await expect(guard.reserve({
      experiment: '   ',
      model: 'gpt-5.6-sol',
      maximumInputTokens: 0,
      maximumOutputTokens: 1_000,
    })).rejects.toThrow();
    expect(await guard.inspect()).toMatchObject({
      spentUsd: 0,
      openReservedUsd: 0,
      calls: [],
    });
  });

  it('releases only a verified pre-dispatch failure', async () => {
    const { guard } = await makeGuard();
    const reservation = await guard.reserve({
      experiment: 'pre-dispatch-failure',
      model: 'gpt-5.6-sol',
      maximumInputTokens: 10_000,
      maximumOutputTokens: 1_000,
    });
    await guard.cancelBeforeDispatch({
      reservationId: reservation.id,
      errorCode: 'prompt_serialization_failed',
    });

    expect(await guard.inspect()).toMatchObject({
      spentUsd: 0,
      openReservedUsd: 0,
      calls: [expect.objectContaining({
        status: 'failed',
        actualUsd: 0,
      })],
    });
  });

  it('cannot release a reservation after dispatch', async () => {
    const { guard } = await makeGuard();
    const reservation = await guard.reserve({
      experiment: 'dispatched-call',
      model: 'gpt-5.6-sol',
      maximumInputTokens: 10_000,
      maximumOutputTokens: 1_000,
    });
    await guard.markDispatched({ reservationId: reservation.id });

    await expect(guard.cancelBeforeDispatch({
      reservationId: reservation.id,
      errorCode: 'connection_error',
    })).rejects.toThrow('cannot be released as unbilled');
    expect(await guard.inspect()).toMatchObject({
      spentUsd: 0,
      openReservedUsd: reservation.reservedUsd,
      calls: [expect.objectContaining({
        status: 'dispatched',
        dispatchedAt: expect.any(String),
      })],
    });
  });

  it('keeps an unresolved timeout charged against the budget', async () => {
    const { guard } = await makeGuard();
    const reservation = await guard.reserve({
      experiment: 'timed-out-call',
      model: 'gpt-5.6-sol',
      maximumInputTokens: 500_000,
      maximumOutputTokens: 128_000,
    });
    await guard.markDispatched({ reservationId: reservation.id });

    await guard.markUnresolved({
      reservationId: reservation.id,
      errorCode: 'response_timeout',
    });

    expect(await guard.inspect()).toMatchObject({
      spentUsd: 0,
      openReservedUsd: reservation.reservedUsd,
      calls: [expect.objectContaining({
        status: 'unresolved',
        actualUsd: null,
      })],
    });

    await expect(guard.reserve({
      experiment: 'would-cross-after-timeout',
      model: 'gpt-5.6-sol',
      maximumInputTokens: 500_000,
      maximumOutputTokens: 128_000,
    })).rejects.toThrow('budget guard refused');
  });

  it.each([
    'connection_error',
    'response_timeout',
    'server_500',
  ])('keeps %s charged after dispatch', async (errorCode) => {
    const { guard } = await makeGuard();
    const reservation = await guard.reserve({
      experiment: `uncertain-${errorCode}`,
      model: 'gpt-5.6-sol',
      maximumInputTokens: 10_000,
      maximumOutputTokens: 1_000,
    });
    await guard.markDispatched({ reservationId: reservation.id });
    await guard.markUnresolved({
      reservationId: reservation.id,
      errorCode,
    });

    expect(await guard.inspect()).toMatchObject({
      spentUsd: 0,
      openReservedUsd: reservation.reservedUsd,
      calls: [expect.objectContaining({
        status: 'unresolved',
        errorCode,
      })],
    });
  });

  it('applies the documented long-context multipliers', () => {
    expect(calculateOpenAiCost(policy, 'gpt-5.6-sol', {
      inputTokens: 300_000,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 10_000,
      reasoningOutputTokens: 0,
    })).toBe(3.45);
  });
});
