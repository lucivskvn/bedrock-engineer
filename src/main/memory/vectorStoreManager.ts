import { FaissStore } from "@langchain/community/vectorstores/faiss";
import type { Embeddings } from "@langchain/core/embeddings"; // Changed to general Embeddings
import { Document } from "@langchain/core/documents"; // Changed to value import
import * as fs from "fs/promises";
import * as path from "path";

// Helper function to ensure directory exists
async function ensureDirExists(dirPath: string) {
  try {
    await fs.access(dirPath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(dirPath, { recursive: true });
    } else {
      throw error;
    }
  }
}

export class VectorStoreManager {
  private store: FaissStore | null = null;
  private storePath: string;
  private embeddings: Embeddings; // Changed to general Embeddings

  constructor(embeddingsInstance: Embeddings, storeDirectory: string = "./.vector_store") {
    this.embeddings = embeddingsInstance;
    // It's conventional for FaissStore.load to expect directory, and it manages files like "docstore.json" and "faiss.index" within it.
    this.storePath = path.resolve(storeDirectory);
  }

  async initialize(): Promise<void> {
    try {
      await ensureDirExists(this.storePath);
      // Check if essential FAISS files exist. FAISS typically creates/expects 'faiss.index'.
      // FaissStore.load itself will throw an error if it can't find the index.
      await fs.access(path.join(this.storePath, "faiss.index"));
      this.store = await FaissStore.load(this.storePath, this.embeddings);
      console.log("Vector store loaded from:", this.storePath);
    } catch (error: any) { // Added :any for simplicity, or type check error
      console.log("Failed to load vector store, creating new one. Error:", error.message);
      // If loading fails (e.g. files not found), a new store will be created on first addDocuments
      this.store = null;
    }
  }

  private async getStore(): Promise<FaissStore> {
    if (!this.store) {
        // This situation implies no documents have been added yet to an empty store.
        // FAISS store is typically created from documents.
        // If we reach here, it means initialize didn't load a store, and no documents were added yet.
        // We'll create an empty one from dummy data, which is a common workaround if a store must exist.
        console.log("Creating a new empty vector store because no existing store was loaded and no documents added yet.");
        const dummyDocs = [new Document({ pageContent: "init", metadata: {temp: true} })];
        this.store = await FaissStore.fromDocuments(dummyDocs, this.embeddings);
        // Immediately delete the dummy document if the store supports deletion, or handle it.
        // For now, this is a simple way to get an empty, queryable store.
        // A better approach might be to handle an empty store state more gracefully in similaritySearch.
    }
    return this.store;
  }


  async addDocuments(documents: Document[]): Promise<void> {
    if (!documents || documents.length === 0) return;

    if (!this.store) {
      // First time adding documents, create the store
      this.store = await FaissStore.fromDocuments(documents, this.embeddings);
      console.log("New vector store created with initial documents.");
    } else {
      // Add to existing store
      await this.store.addDocuments(documents);
      console.log(`${documents.length} documents added to existing vector store.`);
    }
    await this.save();
  }

  async similaritySearch(query: string, k: number = 3): Promise<Document[]> {
    const currentStore = await this.getStore();
    if (!currentStore) {
        console.warn("Attempted to search before store is initialized or any documents are added.");
        return [];
    }
    // Check if dummy doc exists and if it's the only one
    const results = await currentStore.similaritySearch(query, k);
    // Filter out dummy doc if it was part of results and not intended
    return results.filter(doc => !(doc.metadata?.temp === true && doc.pageContent === "init"));
  }

  async save(): Promise<void> {
    if (!this.store) {
      console.log("No vector store to save.");
      return;
    }
    await ensureDirExists(this.storePath);
    await this.store.save(this.storePath);
    console.log("Vector store saved to:", this.storePath);
  }

  getStorePath(): string {
    return this.storePath;
  }
}
