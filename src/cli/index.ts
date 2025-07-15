#!/usr/bin/env node
import { Command } from 'commander';
import * as readline from 'readline';
import Agent from '../main/lib/agent';
import path from 'path';
import os from 'os';

const program = new Command();

program
  .version('1.0.0')
  .description('A CLI for interacting with the Bedrock Agent')
  .action(async () => {
    const vectorStorePath = path.join(os.homedir(), '.bedrock-agent-memory');
    const agent = new Agent(vectorStorePath);
    await agent.initialize();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('Bedrock Agent CLI. Type "exit" to quit.');

    const chat = async () => {
      rl.question('You: ', async (input) => {
        if (input.toLowerCase() === 'exit') {
          rl.close();
          return;
        }

        const responseGenerator = await agent.chat(input);
        process.stdout.write('Agent: ');
        for await (const chunk of responseGenerator) {
          process.stdout.write(chunk);
        }
        process.stdout.write('\n');
        chat();
      });
    };

    chat();
  });

program.parse(process.argv);
