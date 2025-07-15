import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { fromNodeProvider } from '@aws-sdk/credential-providers';

class Agent {
  private client: BedrockRuntimeClient;
  private history: { role: 'user' | 'assistant'; content: string }[];

  constructor() {
    this.client = new BedrockRuntimeClient({
      region: 'us-east-1',
    });
    this.history = [];
  }

  async chat(
    prompt: string
  ): Promise<AsyncGenerator<string, void, unknown>> {
    this.history.push({ role: 'user', content: prompt });

    const params = {
      modelId: 'anthropic.claude-v2',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        prompt: this.createPrompt(),
        max_tokens_to_sample: 300,
        temperature: 0.9,
        top_p: 1,
      }),
    };

    const command = new InvokeModelWithResponseStreamCommand(params);
    const response = await this.client.send(command);

    return this.processResponse(response);
  }

  private createPrompt(): string {
    let prompt = 'Human: ';
    for (const message of this.history) {
      if (message.role === 'user') {
        prompt += `${message.content}\n\n`;
      } else {
        prompt += `Assistant: ${message.content}\n\n`;
      }
    }
    prompt += 'Assistant:';
    return prompt;
  }

  private async *processResponse(
    response: any
  ): AsyncGenerator<string, void, unknown> {
    let assistantMessage = '';
    for await (const event of response.body) {
      if (event.chunk) {
        const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
        const completion = chunk.completion;
        assistantMessage += completion;
        yield completion;
      }
    }
    this.history.push({ role: 'assistant', content: assistantMessage });
  }
}

export default Agent;
