export class BedrockRuntimeClient {
  send = jest.fn().mockImplementation((command) => {
    console.log('command.body:', command.body);
    const { prompt } = JSON.parse(command.body);
    const response = prompt.includes('John')
      ? 'Your name is John.'
      : 'I do not know your name.';
    return {
      body: (async function* () {
        yield {
          chunk: {
            bytes: new TextEncoder().encode(
              `{"completion": "${response}"}`
            ),
          },
        };
      })(),
    };
  });
}

export const InvokeModelWithResponseStreamCommand = jest.fn().mockImplementation((params) => {
  return params;
});
