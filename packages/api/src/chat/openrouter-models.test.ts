import { expect, it, vi } from 'vitest';
import { OpenRouterModelCatalog } from './openrouter-models';

const model = {
  id: 'minimax/minimax-m3.1-flash:free',
  pricing: { prompt: '0', completion: '0' },
  reasoning: {
    mandatory: true,
    default_effort: 'max',
    supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low'],
  },
};
it('discovers mandatory reasoning, chooses a supported low effort, and caches public metadata', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ data: [model] })));
  const catalog = new OpenRouterModelCatalog(fetcher);
  expect(await catalog.policy(model.id)).toEqual({
    reasoning: { effort: 'low', exclude: true },
    minimumCompletionTokens: 8192,
  });
  expect((await catalog.policy(model.id, 99_999))?.minimumCompletionTokens).toBe(16_384);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('headers');
});
it('preserves the user token cap for paid models and ignores non-reasoning models', async () => {
  const paid = {
    ...model,
    id: 'minimax/minimax-m3.1-flash',
    pricing: { prompt: '0.1', completion: '0.2' },
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [paid, { id: 'plain/model:free', pricing: { prompt: '0', completion: '0' } }],
      }),
    ),
  );
  const catalog = new OpenRouterModelCatalog(fetcher);
  expect(await catalog.policy(paid.id)).toBeUndefined();
  expect(await catalog.policy('plain/model:free')).toBeUndefined();
});
it('keeps chat usable if the optional public model catalog is unavailable', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
  expect(await new OpenRouterModelCatalog(fetcher).policy(model.id)).toBeUndefined();
});

it('does not expand the token cap for an unverified free suffix', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [null, { ...model, pricing: { prompt: '0.01', completion: '0.01' } }],
      }),
    ),
  );
  expect(await new OpenRouterModelCatalog(fetcher).policy(model.id)).toBeUndefined();
});
