import { getDefaultPromptRouter, getModelsForRegion } from '../models'
import { getAccountId } from '../utils/awsUtils'
import type { ServiceContext, AwsClientConfig } from '../types'
import { BedrockSupportRegion } from '../../../../types/llm'
import NodeCache from 'node-cache' // Added

const modelCache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

export class ModelService {
  constructor(private context: ServiceContext) {}

  async listModels() {
    const awsConfig = this.context.store.get('aws') as AwsClientConfig
    const { region } = awsConfig

    // AWS認証情報のバリデーション (Region is the main concern here for client creation)
    if (!region) {
      console.warn('AWS region is not configured. Cannot list models.')
      return []
    }

    const cacheKey = `bedrock_listModels_region_${region}`;
    const cachedModels = modelCache.get<any[]>(cacheKey); // Specify type if known, e.g., LLM[]

    if (cachedModels) {
      console.log(`[Cache HIT] Returning cached models for region ${region}`);
      return cachedModels;
    }

    console.log(`[Cache MISS] Fetching models from API for region ${region}`);
    try {
      const models = getModelsForRegion(region as BedrockSupportRegion)
      const accountId = await getAccountId(awsConfig) // Assuming getAccountId is updated for AwsClientConfig
      const promptRouterModels = accountId ? getDefaultPromptRouter(accountId, region) : []
      const result = [...models, ...promptRouterModels]

      modelCache.set(cacheKey, result);
      return result
    } catch (error) {
      console.error('Error in listModels fetching from API:', error)
      return [] // Return empty or throw, depending on desired error handling
    }
  }
}
