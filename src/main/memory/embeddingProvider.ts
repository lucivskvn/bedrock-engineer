import { BedrockEmbeddings } from "@langchain/aws";
import type { AwsClientConfig } from "../api/bedrock/types"; // Assuming this path is correct

interface EmbeddingProviderConfig {
  region?: string;
  model?: string; // e.g., "amazon.titan-embed-text-v1"
  profile?: string; // Optional AWS profile
}

export class EmbeddingProvider {
  private embeddings: BedrockEmbeddings;
  public readonly dimensions: number; // To store the dimensions of the embeddings

  constructor(awsConfig: AwsClientConfig, providerConfig?: EmbeddingProviderConfig) {
    const region = awsConfig.region || providerConfig?.region || process.env.AWS_REGION || "us-east-1";
    const model = providerConfig?.model || "amazon.titan-embed-text-v1"; // Default embedding model

    // Note: BedrockEmbeddings from @langchain/aws should handle AWS credentials
    // automatically via the default provider chain, including profiles set via AWS_PROFILE
    // or in ~/.aws/config if awsConfig.profile is not directly used by it.
    // If specific profile from awsConfig is needed, BedrockEmbeddings might need
    // `credentials` explicitly set using `fromIni({ profile: awsConfig.profile })`
    // For now, relying on default SDK behavior.
    this.embeddings = new BedrockEmbeddings({
      region: region,
      model: model,
      // credentials: awsConfig.profile ? fromIni({ profile: awsConfig.profile }) : undefined // Example if explicit profile needed
    });

    // Determine dimensions based on the model (this is a common practice)
    // These are typical values, might need to be fetched or configured if models change
    if (model.includes("cohere.embed")) {
        this.dimensions = 1024; // or 4096 for multilingual v3
    } else if (model.includes("amazon.titan-embed-text-v1")) {
        this.dimensions = 1536;
    } else if (model.includes("amazon.titan-embed-image-v1")) {
        this.dimensions = 1024; // And also requires image input
    } else {
        // Default or throw error
        this.dimensions = 1536; // Defaulting to Titan text embedding size
        console.warn(`Unknown embedding model ${model}, defaulting dimensions to ${this.dimensions}. Accuracy may be affected.`);
    }
  }

  async getEmbedding(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }

  public getEmbeddingsInstance(): BedrockEmbeddings { // Or more general Embeddings if preferred
    return this.embeddings;
  }
}
