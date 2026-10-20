type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface OpenRouterModelPolicy {
  reasoning: { effort?: Effort; exclude: true };
  minimumCompletionTokens?: number;
}
type Model = {
  id: string;
  reasoning?: {
    mandatory?: boolean;
    default_enabled?: boolean;
    default_effort?: string;
    supported_efforts?: string[];
  };
  pricing?: { prompt?: string; completion?: string };
};
const EFFORTS: Effort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Public capabilities only. No user key or repository content is sent to this endpoint. */
export class OpenRouterModelCatalog {
  private models: Model[] = [];
  private expires = 0;
  private pending?: Promise<void>;
  constructor(private fetcher: typeof fetch = fetch) {}

  async policy(
    modelId: string,
    freeTokenBudget = 8192,
  ): Promise<OpenRouterModelPolicy | undefined> {
    if (Date.now() >= this.expires) {
      this.pending ??= this.refresh();
      try {
        await this.pending;
      } finally {
        this.pending = undefined;
      }
    }
    const model = this.models.find((item) => item.id === modelId);
    const config = model?.reasoning;
    if (
      !config ||
      !(
        config.mandatory ||
        config.default_enabled ||
        (config.default_effort && config.default_effort !== 'none')
      )
    )
      return undefined;
    const effort = EFFORTS.find(
      (value) =>
        Array.isArray(config.supported_efforts) && config.supported_efforts.includes(value),
    );
    const free =
      modelId.endsWith(':free') &&
      model?.pricing?.prompt === '0' &&
      model.pricing.completion === '0';
    return {
      reasoning: { ...(effort ? { effort } : {}), exclude: true },
      ...(free
        ? {
            minimumCompletionTokens:
              Number.isSafeInteger(freeTokenBudget) && freeTokenBudget > 0
                ? Math.min(freeTokenBudget, 16_384)
                : 8192,
          }
        : {}),
    };
  }
  private async refresh(): Promise<void> {
    try {
      const response = await this.fetcher('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error('Catalog unavailable.');
      const body = (await response.json()) as { data?: unknown[] };
      if (!Array.isArray(body.data)) throw new Error('Invalid catalog.');
      this.models = body.data
        .slice(0, 5000)
        .filter((model): model is Model =>
          Boolean(
            model && typeof model === 'object' && 'id' in model && typeof model.id === 'string',
          ),
        );
      this.expires = Date.now() + 5 * 60_000;
    } catch {
      this.expires = Date.now() + 5_000;
    }
  }
}
export const openRouterModelCatalog = new OpenRouterModelCatalog();
