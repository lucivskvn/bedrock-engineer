import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { BedrockEmbeddings } from '@langchain/community/embeddings/bedrock';
import { Document } from 'langchain/document';

class Agent {
  private client: BedrockRuntimeClient;
  private history: { role: 'user' | 'assistant'; content: string }[];
  private vectorStore: FaissStore | null;
  private vectorStorePath: string;

  constructor(vectorStorePath: string) {
    this.client = new BedrockRuntimeClient({
      region: 'us-east-1',
      credentials: fromNodeProviderChain(),
    });
    this.history = [];
    this.vectorStorePath = vectorStorePath;
    this.vectorStore = null;
  }

  async initialize() {
    if (this.vectorStore) {
      return;
    }

    try {
      this.vectorStore = await FaissStore.load(
        this.vectorStorePath,
        new BedrockEmbeddings({
          region: 'us-east-1',
          credentials: fromNodeProviderChain(),
        })
      );
    } catch (error) {
      this.vectorStore = await FaissStore.fromTexts(
        [''],
        [],
        new BedrockEmbeddings({
          region: 'us-east-1',
          credentials: fromNodeProviderChain(),
        })
      );
    }
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
        prompt: await this.createPrompt(prompt),
        max_tokens_to_sample: 300,
        temperature: 0.9,
        top_p: 1,
      }),
    };

    const command = new InvokeModelWithResponseStreamCommand(params);
    const response = await this.client.send(command);

    const fullResponse = await this.processResponse(response);
    if (this.vectorStore) {
      await this.vectorStore.addDocuments([
        new Document({ pageContent: `Human: ${prompt}` }),
        new Document({ pageContent: `Assistant: ${fullResponse}` }),
      ]);
      await this.vectorStore.save(this.vectorStorePath);
    }
    return this.streamResponse(fullResponse);
  }

  private async createPrompt(prompt: string): Promise<string> {
    const similarDocs = await this.vectorStore!.similaritySearch(prompt, 2);
    const context = similarDocs.map((doc) => doc.pageContent).join('\n\n');

    let fullPrompt = 'Human: ';
    if (context) {
      fullPrompt += `Here is some relevant context:\n${context}\n\n`;
    }

    for (const message of this.history) {
      if (message.role === 'user') {
        fullPrompt += `${message.content}\n\n`;
      } else {
        fullPrompt += `Assistant: ${message.content}\n\n`;
      }
    }
    fullPrompt += 'Assistant:';
    return fullPrompt;
  }

  private async processResponse(response: any): Promise<string> {
    let assistantMessage = '';
    for await (const event of response.body) {
      if (event.chunk) {
        const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
        const completion = chunk.completion;
        assistantMessage += completion;
      }
    }
    this.history.push({ role: 'assistant', content: assistantMessage });
    return assistantMessage;
  }

  private async *streamResponse(
    response: string
  ): AsyncGenerator<string, void, unknown> {
    for (const chunk of response.split('')) {
      yield chunk;
    }
  }
}

export default Agent;
