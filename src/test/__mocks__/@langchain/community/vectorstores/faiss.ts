export class FaissStore {
  static load = jest.fn().mockImplementation(() => {
    return new FaissStore();
  });

  static fromTexts = jest.fn().mockImplementation(() => {
    return new FaissStore();
  });

  save = jest.fn();

  similaritySearch = jest.fn().mockResolvedValue([]);

  addDocuments = jest.fn();
}
