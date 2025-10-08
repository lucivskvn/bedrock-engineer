import { BedrockService } from './bedrock'
import { store, storeReady } from '../../preload/store'

let cachedService: BedrockService | null = null

export async function getBedrockService(): Promise<BedrockService> {
  if (!cachedService) {
    await storeReady
    cachedService = new BedrockService({ store })
  }
  return cachedService
}

export function resetBedrockService(): void {
  cachedService = null
}

export const __test__ = {
  setBedrockService(service: BedrockService | null) {
    cachedService = service
  }
}
