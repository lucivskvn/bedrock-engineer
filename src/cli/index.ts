#!/usr/bin/env node

import { Command } from 'commander';
import { ConverseService } from '../main/api/bedrock/services/converseService';
import { PersistentMemoryService } from '../main/memory/persistentMemoryService'; // Added
import type { ServiceContext, CallConverseAPIProps, AwsClientConfig, InferenceParams, ThinkingMode } from '../main/api/bedrock/types';
import type { Message, SystemContentBlock } from '@aws-sdk/client-bedrock-runtime';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

// Minimal mock for ElectronStore's ConfigStore type
class MockConfigStore {
  private config: Record<string, any>;

  constructor(initialConfig: Record<string, any>) {
    this.config = initialConfig;
  }

  get(key: string): any {
    return this.config[key];
  }

  // Add set if needed, but for now, only get is used by ConverseService
}

const program = new Command();

program
  .version('0.1.0')
  .description('CLI for Bedrock Agent chat')
  .option('-m, --model-id <modelId>', 'Bedrock model ID to use', 'anthropic.claude-3-sonnet-20240229-v1:0')
  .option('-r, --region <region>', 'AWS Region', process.env.AWS_REGION || 'us-east-1')
  .option('--profile <profile>', 'AWS profile to use', process.env.AWS_PROFILE || 'default')
  .action(async (options) => {
    const { modelId, region, profile } = options;

    // Setup mock store with necessary configurations
    // These would ideally be loaded from a config file or more CLI args
    const awsConfig: AwsClientConfig = {
      region: region,
      profile: profile,
      // Assuming proxy is not used for CLI for simplicity
    };
    const inferenceParams: InferenceParams = {
      maxTokens: 2048,
      temperature: 0.7,
      topP: 0.9,
    };
    const thinkingMode: ThinkingMode = { type: 'disabled' }; // Or 'enabled' with budget_tokens
    const interleaveThinking: boolean = false;
    // guardrailSettings can be undefined if not used

    const mockStore = new MockConfigStore({
      aws: awsConfig,
      inferenceParams: inferenceParams,
      thinkingMode: thinkingMode,
      interleaveThinking: interleaveThinking,
      // guardrailSettings: { enabled: false } // Example if needed
    });

    const serviceContext: ServiceContext = {
      store: mockStore as any, // Cast to any to satisfy ConfigStore type if it has more methods
    };

    const converseService = new ConverseService(serviceContext);
    // const bedrockService = new BedrockService(serviceContext); // Reverted: Added for listModels

    // // TEMP: Test listModels caching
    // console.log("Attempting to list models (1st call)...");
    // await bedrockService.listModels();
    // console.log("Attempting to list models (2nd call - should be cached)...");
    // await bedrockService.listModels();
    // // END TEMP

    // Initialize PersistentMemoryService
    const memoryService = new PersistentMemoryService({
      awsConfig: awsConfig, // Already defined from CLI options
      // vectorStoreDirectory: "./.bedrock_agent_memory", // Optional: customize path
      // embeddingModel: "amazon.titan-embed-text-v2:0" // Optional: customize model
    });
    await memoryService.initialize();
    console.log("Memory service initialized.");

    const rl = readline.createInterface({ input, output });

    console.log(`Starting chat with model ${modelId}. Type 'exit' or 'quit' to end.`);

    const conversationHistory: Message[] = [];
    const baseSystemPromptText = "You are a helpful AI assistant.";

    while (true) {
      const userInput = await rl.question('You: ');

      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        break;
      }

      conversationHistory.push({ role: 'user', content: [{ text: userInput }] });

      // 1. Retrieve relevant memories
      const retrievedMemories = await memoryService.retrieveContextualMemories(userInput);
      let memoryContext = "";
      if (retrievedMemories.length > 0) {
        memoryContext = "Relevant context from past conversations:\n" +
                        retrievedMemories.map(doc => doc.pageContent).join("\n---\n");
      }

      const currentSystemPrompt: SystemContentBlock[] = [{
        text: memoryContext ? `${baseSystemPromptText}\n\n${memoryContext}` : baseSystemPromptText
      }];

      const apiProps: CallConverseAPIProps = {
        modelId: modelId,
        messages: [...conversationHistory], // Send a copy
        system: currentSystemPrompt, // Use updated system prompt with memory
        inferenceConfig: { // From @aws-sdk/client-bedrock-runtime
          maxTokens: inferenceParams.maxTokens,
          temperature: inferenceParams.temperature,
          topP: inferenceParams.topP,
        }
        // toolConfig and guardrailConfig can be added if needed
      };

      try {
        const response = await converseService.converseStream(apiProps);
        let fullResponse = "";
        process.stdout.write('Agent: ');

        if (response.stream) {
          for await (const event of response.stream) {
            if (event.contentBlockDelta?.delta?.text) {
              process.stdout.write(event.contentBlockDelta.delta.text);
              fullResponse += event.contentBlockDelta.delta.text;
            } else if (event.messageStop?.stopReason) {
              const stopReason = event.messageStop.stopReason;
              if (stopReason === 'content_filtered' || stopReason === 'guardrail_intervened') {
                process.stdout.write(`\n[The model's response was filtered due to: ${stopReason}. Please try rephrasing your request.]\n`);
                // fullResponse might be empty or partial, which is fine.
                // The turn will still be saved to memory if needed, showing an empty/filtered assistant response.
              } else {
                // Log other stop reasons for debugging if desired, but not as errors.
                // console.log(`\n(Message stop reason: ${stopReason})`);
              }
            } else if (event.internalServerException) {
              console.error('\nServer Exception:', event.internalServerException.message);
              break;
            } else if (event.throttlingException) {
              console.warn('\nThrottling Exception. Please try again later.');
              break;
            }
          }
          process.stdout.write('\n'); // Newline after agent's full response
          if (fullResponse) {
            conversationHistory.push({ role: 'assistant', content: [{ text: fullResponse }] });
            // 2. Store the conversation turn
            await memoryService.addConversationTurn(userInput, fullResponse);
          }
        } else {
          console.log('\nAgent: No stream in response.');
        }
      } catch (error: any) {
        console.error('\nError during agent chat:', error.message || error);
        // Remove the last user message if the call failed, so they can retry
        conversationHistory.pop();
      }
    }

    rl.close();
    console.log('Exiting chat.');
  });

program.parse(process.argv);
