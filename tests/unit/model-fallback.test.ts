/**
 * Model fallback-chain resilience (network-hermetic, NO live model).
 *
 * Uses local mock LanguageModelV2 objects so a "model 429" is simulated entirely
 * in-process. Asserts the orchestrator-style fallback chain retries the first
 * model and then degrades flash -> flash-lite, and that a healthy first model is
 * used without falling through.
 */

import { describe, expect, it } from 'vitest';
import { Agent } from '@mastra/core/agent';
import { orchestratorModel, MODEL_IDS } from '../../src/config/index.js';

interface MockModel {
  specificationVersion: 'v2';
  provider: string;
  modelId: string;
  supportedUrls: Record<string, RegExp[]>;
  calls: number;
  doGenerate: () => Promise<unknown>;
  doStream: () => Promise<unknown>;
}

function mockModel(modelId: string, behave: () => unknown): MockModel {
  const m: MockModel = {
    specificationVersion: 'v2',
    provider: 'mock',
    modelId,
    supportedUrls: {},
    calls: 0,
    async doGenerate() {
      m.calls += 1;
      return behave();
    },
    async doStream() {
      throw new Error('stream not supported by mock');
    },
  };
  return m;
}

const okText = (modelId: string) => () => ({
  content: [{ type: 'text', text: `answer from ${modelId}` }],
  finishReason: 'stop',
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  warnings: [],
});

const throw429 = () => {
  throw Object.assign(new Error('rate limited'), {
    statusCode: 429,
    isRetryable: true,
    name: 'AI_APICallError',
  });
};

function agentWith(flash: MockModel, lite: MockModel): Agent {
  return new Agent({
    id: 'fallback-test',
    name: 'Fallback Test',
    instructions: 'test',
    // Mirrors orchestratorModel's shape: [flash, flash-lite] with per-model retries.
    model: [
      { model: flash as unknown as string, maxRetries: 1 },
      { model: lite as unknown as string, maxRetries: 1 },
    ],
  });
}

describe('model fallback chain', () => {
  it('is configured flash -> flash-lite with per-model retries', () => {
    expect(orchestratorModel.map((m) => m.model)).toEqual([MODEL_IDS.flash, MODEL_IDS.flashLite]);
    expect(orchestratorModel.every((m) => (m.maxRetries ?? 0) >= 1)).toBe(true);
  });

  it('retries the first model on a 429, then switches to flash-lite', async () => {
    const flash = mockModel('flash', throw429);
    const lite = mockModel('flash-lite', okText('flash-lite'));

    const res = await agentWith(flash, lite).generate('hi', { maxSteps: 1 });

    expect(res.text).toContain('flash-lite');
    expect(flash.calls).toBeGreaterThanOrEqual(2); // initial + at least one retry
    expect(lite.calls).toBe(1); // fell back exactly once
  });

  it('uses the first model and does NOT fall through when it succeeds', async () => {
    const flash = mockModel('flash', okText('flash'));
    const lite = mockModel('flash-lite', okText('flash-lite'));

    const res = await agentWith(flash, lite).generate('hi', { maxSteps: 1 });

    expect(res.text).toContain('answer from flash');
    expect(lite.calls).toBe(0); // never reached the fallback
  });
});
