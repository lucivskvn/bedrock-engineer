import Agent from './agent';
import os from 'os';
import path from 'path';
import fs from 'fs';

jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('@langchain/community/embeddings/bedrock');

describe('Agent', () => {
  let agent: Agent;
  let vectorStorePath: string;

  beforeEach(async () => {
    vectorStorePath = path.join(os.tmpdir(), `test-memory-${Date.now()}`);
    agent = new Agent(vectorStorePath);
    await agent.initialize();
  });

  afterEach(() => {
    if (fs.existsSync(vectorStorePath)) {
      fs.rmSync(vectorStorePath, { recursive: true, force: true });
    }
  });

  it('should remember the conversation', async () => {
    const responseGenerator1 = await agent.chat('My name is John');
    for await (const _ of responseGenerator1) {
      // consume the generator
    }

    const responseGenerator2 = await agent.chat('What is my name?');
    let response = '';
    for await (const chunk of responseGenerator2) {
      response += chunk;
    }

    expect(response).toContain('John');
  });
});
