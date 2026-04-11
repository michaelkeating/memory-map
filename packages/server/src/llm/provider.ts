import Anthropic from "@anthropic-ai/sdk";

export interface LLMToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface LLMResponse {
  text: string;
  toolUse: LLMToolUse[];
  /** Raw content blocks — pass back to LLM as the next assistant message */
  contentBlocks: Anthropic.ContentBlock[];
  stopReason: Anthropic.Message["stop_reason"];
}

/** A single message in the conversation. content is either a string or
 * an array of blocks (used for tool_use / tool_result replays). */
export type LLMMessage = {
  role: "user" | "assistant";
  content: string | Anthropic.MessageParam["content"];
};

export interface LLMProvider {
  chat(params: {
    system: string;
    messages: LLMMessage[];
    tools?: Anthropic.Tool[];
    maxTokens?: number;
  }): Promise<LLMResponse>;

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
    messages: LLMMessage[];
    tools?: Anthropic.Tool[];
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: params.maxTokens ?? 4096,
      system: params.system,
      messages: params.messages as Anthropic.MessageParam[],
      tools: params.tools,
    });

    let text = "";
    const toolUse: LLMToolUse[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolUse.push({ id: block.id, name: block.name, input: block.input });
      }
    }

    return {
      text,
      toolUse,
      contentBlocks: response.content,
      stopReason: response.stop_reason,
    };
  }
}
