export class BedrockEmbeddings {
  constructor() {}

  embedDocuments = jest.fn().mockImplementation((documents) => {
    return Promise.resolve(documents.map(() => [1, 2, 3]));
  });

  embedQuery = jest.fn().mockResolvedValue([1, 2, 3]);
}
