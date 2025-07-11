import { Document } from "@langchain/core/documents";
import { EmbeddingProvider } from "./embeddingProvider";
import { VectorStoreManager } from "./vectorStoreManager";
import type { AwsClientConfig } from "../api/bedrock/types";

// Configuration for the PersistentMemoryService
interface PersistentMemoryServiceConfig {
  awsConfig: AwsClientConfig; // For EmbeddingProvider
  embeddingModel?: string; // e.g., "amazon.titan-embed-text-v1"
  vectorStoreDirectory?: string; // Directory to store FAISS index
  defaultRetrievalCount?: number; // Default number of memories to retrieve
}

export class PersistentMemoryService {
  private embeddingProvider: EmbeddingProvider;
  private vectorStoreManager: VectorStoreManager;
  private defaultRetrievalCount: number;

  constructor(config: PersistentMemoryServiceConfig) {
    this.embeddingProvider = new EmbeddingProvider(config.awsConfig, {
      model: config.embeddingModel,
      region: config.awsConfig.region, // Pass region explicitly if needed by EmbeddingProvider's BedrockEmbeddings
    });

    // Pass the actual BedrockEmbeddings instance from EmbeddingProvider to VectorStoreManager
    this.vectorStoreManager = new VectorStoreManager(
      this.embeddingProvider.getEmbeddingsInstance(), // Use the getter
      config.vectorStoreDirectory
    );

    this.defaultRetrievalCount = config.defaultRetrievalCount || 3;
  }

  /**
   * Initializes the memory service, primarily loading the vector store.
   */
  async initialize(): Promise<void> {
    // EmbeddingProvider doesn't need explicit init for BedrockEmbeddings
    await this.vectorStoreManager.initialize();
    console.log("PersistentMemoryService initialized. Vector store ready at:", this.vectorStoreManager.getStorePath());
  }

  /**
   * Adds a conversation turn (user input and assistant output) to the memory.
   * @param userInput The text of the user's input.
   * @param assistantOutput The text of the assistant's response.
   * @param sessionId Optional session ID for multi-user or multi-session scenarios.
   */
  async addConversationTurn(userInput: string, assistantOutput: string, sessionId?: string): Promise<void> {
    const turnText = `User: ${userInput}\nAssistant: ${assistantOutput}`;
    const metadata: Record<string, any> = {
      timestamp: new Date().toISOString(),
      type: "conversationTurn",
    };
    if (sessionId) {
      metadata.sessionId = sessionId;
    }

    const document = new Document({ pageContent: turnText, metadata });

    // Embeddings are handled by FaissStore when documents are added via an Embeddings instance.
    // So, we don't need to call embeddingProvider.getEmbedding(s) directly here for addDocuments.
    await this.vectorStoreManager.addDocuments([document]);
    console.log("Conversation turn added to memory.");
  }

  /**
   * Retrieves contextual memories relevant to the given query.
   * @param query The query text (e.g., current user input).
   * @param sessionId Optional session ID to filter memories.
   * @param k Optional number of memories to retrieve.
   * @returns An array of Document objects representing relevant memories.
   */
  async retrieveContextualMemories(query: string, sessionId?: string, k?: number): Promise<Document[]> {
    const numToRetrieve = k || this.defaultRetrievalCount;

    // Note: FAISS (and most vector stores in LangChain) performs similarity search on document embeddings.
    // The query itself is embedded by the similaritySearch method using the provided embeddings instance.

    // If sessionId filtering is needed, FAISS doesn't support metadata filtering directly in similaritySearch
    // without a custom setup or a different vector store that does (e.g., Chroma, Pinecone with pre-filtering).
    // For FAISS, one would typically retrieve more documents and then filter them in application code,
    // or structure the FAISS index per session (more complex).
    // For now, this retrieves globally. Session-specific retrieval would be an enhancement.
    if (sessionId) {
      console.warn("Session ID filtering is not yet implemented for FAISS retrieval in this service. Retrieving globally.");
    }

    const relevantDocs = await this.vectorStoreManager.similaritySearch(query, numToRetrieve);
    console.log(`Retrieved ${relevantDocs.length} memories for query: "${query.substring(0,50)}..."`);
    return relevantDocs;
  }

  /**
   * Saves the current state of the memory (specifically the vector store).
   */
  async save(): Promise<void> {
    await this.vectorStoreManager.save();
  }
}
