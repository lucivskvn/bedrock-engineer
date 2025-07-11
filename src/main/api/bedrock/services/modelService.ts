import { getDefaultPromptRouter, getModelsForRegion } from '../models'
import { getAccountId } from '../utils/awsUtils'
import type { ServiceContext, AwsClientConfig } from '../types' // Changed AWSCredentials to AwsClientConfig
import { BedrockSupportRegion } from '../../../../types/llm'

export class ModelService {
  constructor(private context: ServiceContext) {}

  async listModels() {
    const awsConfig = this.context.store.get('aws') as AwsClientConfig // Changed variable name and type
    const { region } = awsConfig

    // AWS認証情報のバリデーション (Region is the main concern here for client creation)
    if (!region) {
      console.warn('AWS region is not configured. Cannot list models.')
      return []
    }

    try {
      const models = getModelsForRegion(region as BedrockSupportRegion)
      // getAccountId will need to be updated to accept AwsClientConfig
      const accountId = await getAccountId(awsConfig)
      const promptRouterModels = accountId ? getDefaultPromptRouter(accountId, region) : []
      const result = [...models, ...promptRouterModels]

      return result
    } catch (error) {
      console.error('Error in listModels:', error)
      return []
    }
  }
}
