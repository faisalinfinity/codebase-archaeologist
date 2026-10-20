export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export type AIStreamEvent = { type: 'delta'; text: string } | { type: 'completed'; usage: AIUsage };

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  stream(input: {
    instructions: string;
    messages: AIMessage[];
    maxOutputTokens: number;
    signal?: AbortSignal;
  }): AsyncIterable<AIStreamEvent>;
}
