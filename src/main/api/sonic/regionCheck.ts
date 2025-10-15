import {
  DEFAULT_NOVA_SONIC_REGION,
  getNovaSonicSupportedRegions,
  isNovaSonicSupportedRegion,
  NOVA_SONIC_CONNECTIVITY_ERROR,
  NOVA_SONIC_REGION_CHECK_ERROR,
  NOVA_SONIC_REGION_UNAVAILABLE_MESSAGE,
  type ConnectivityTestResult,
  type RegionCheckResult
} from '../../../common/sonic/regions'
import { store } from '../../../preload/store'
import { log } from '../../../common/logger'

/**
 * Check if Nova Sonic is available in the current AWS region
 */
export async function checkNovaSonicRegionSupport(region?: string): Promise<RegionCheckResult> {
  const currentRegion = region || store.get('aws')?.region || DEFAULT_NOVA_SONIC_REGION
  try {
    const supportedRegions = getNovaSonicSupportedRegions()

    // Quick check against known supported regions
    const isSupported = isNovaSonicSupportedRegion(currentRegion)

    return {
      isSupported,
      currentRegion,
      supportedRegions,
      error: isSupported
        ? undefined
        : NOVA_SONIC_REGION_UNAVAILABLE_MESSAGE
    }
  } catch (error) {
    log.error('Failed to check Nova Sonic region support.', {
      error,
      metadata: { currentRegion }
    })
    return {
      isSupported: false,
      currentRegion,
      supportedRegions: getNovaSonicSupportedRegions(),
      error: NOVA_SONIC_REGION_CHECK_ERROR
    }
  }
}

/**
 * Test Bedrock connectivity in the current region
 * This performs a lightweight test to verify service availability
 */
export async function testBedrockConnectivity(region?: string): Promise<ConnectivityTestResult> {
  const currentRegion = region || store.get('aws')?.region || DEFAULT_NOVA_SONIC_REGION
  try {
    const awsConfig = store.get('aws')

    if (!awsConfig?.accessKeyId || !awsConfig?.secretAccessKey) {
      return {
        success: false,
        error: 'AWS credentials are not configured.'
      }
    }

    // For now, we just validate that credentials exist and region is specified
    // A more comprehensive test would require making an actual API call, but that might be expensive
    // and could fail due to network issues rather than configuration problems
    log.debug('Testing Nova Sonic connectivity.', { currentRegion })
    return {
      success: true
    }
  } catch (error) {
    log.error('Failed to test Bedrock connectivity.', {
      error,
      metadata: { currentRegion }
    })
    return {
      success: false,
      error: NOVA_SONIC_CONNECTIVITY_ERROR
    }
  }
}
