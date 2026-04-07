import Anthropic from "@anthropic-ai/sdk";

export interface LLMProvider {
  chat(params: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    tools?: Anthropic.Tool[];
    maxTokens?: number;
  }): Promise<{
    text: string;
    toolUse: Array<{ name: string; input: unknown }>;
  }>;

  readonly modelId: string;
}

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;

  constructor(
    private model: string,
    apiKey: string
  ) {
    this.client = new Anthropic({ apiKey });
  }

  get modelId(): string {
    return this.model;
  }

  async chat(params: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    tools?: Anthropic.Tool[];
    maxTokens?: number;
  }) {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: params.maxTokens ?? 4096,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
    });

    let text = "";
    const toolUse: Array<{ name: string; input: unknown }> = [];

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolUse.push({ name: block.name, input: block.input });
      }
    }

    return { text, toolUse };
  }
}
