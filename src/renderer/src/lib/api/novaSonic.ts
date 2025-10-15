import {
  getNovaSonicSupportedRegions,
  NOVA_SONIC_CONNECTIVITY_ERROR,
  NOVA_SONIC_REGION_CHECK_ERROR,
  NOVA_SONIC_REGION_UNAVAILABLE_MESSAGE,
  type ConnectivityTestResult,
  type RegionCheckResult
} from '@common/sonic/regions'
import { rendererLogger as log } from '@renderer/lib/logger'
import { getTrustedApiEndpoint } from '@renderer/lib/security/apiEndpoint'

export type { ConnectivityTestResult, RegionCheckResult }

const getAuthHeaders = () => {
  const apiAuthToken = window.store.get('apiAuthToken') as string | undefined
  if (apiAuthToken && apiAuthToken.length > 0) {
    return { 'X-API-Key': apiAuthToken }
  }
  return undefined
}

const getApiEndpoint = () => getTrustedApiEndpoint()

/**
 * Check if Nova Sonic is supported in the current or specified region
 */
export async function checkNovaSonicRegionSupport(region?: string): Promise<RegionCheckResult> {
  try {
    const url = new URL('/nova-sonic/region-check', getApiEndpoint())
    if (region) {
      url.searchParams.set('region', region)
    }

    const response = await fetch(url.toString(), {
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      const errorMessage =
        typeof errorData.error?.message === 'string' ? errorData.error.message : undefined
      throw new Error(NOVA_SONIC_REGION_CHECK_ERROR, {
        cause: {
          status: response.status,
          errorMessage
        }
      })
    }

    const result = (await response.json()) as RegionCheckResult
    if (!result.isSupported && !result.error) {
      return {
        ...result,
        error: NOVA_SONIC_REGION_UNAVAILABLE_MESSAGE
      }
    }
    return result
  } catch (error) {
    const cause = error instanceof Error && typeof error.cause === 'object' ? error.cause : undefined
    const metadata: Record<string, unknown> = {
      requestedRegion: region ?? 'unspecified'
    }
    if (cause) {
      Object.assign(metadata, cause as Record<string, unknown>)
    }
    log.error('Failed to check Nova Sonic region support.', {
      error,
      metadata
    })
    return {
      isSupported: false,
      currentRegion: region || 'unknown',
      supportedRegions: getNovaSonicSupportedRegions(),
      error: NOVA_SONIC_REGION_CHECK_ERROR
    }
  }
}

/**
 * Test Bedrock connectivity in the current or specified region
 */
export async function testBedrockConnectivity(region?: string): Promise<ConnectivityTestResult> {
  try {
    const url = new URL('/bedrock/connectivity-test', getApiEndpoint())
    if (region) {
      url.searchParams.set('region', region)
    }

    const response = await fetch(url.toString(), {
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      const errorMessage =
        typeof errorData.error?.message === 'string' ? errorData.error.message : undefined
      throw new Error(NOVA_SONIC_CONNECTIVITY_ERROR, {
        cause: {
          status: response.status,
          errorMessage
        }
      })
    }

    return await response.json()
  } catch (error) {
    const cause = error instanceof Error && typeof error.cause === 'object' ? error.cause : undefined
    const metadata: Record<string, unknown> = {
      requestedRegion: region ?? 'unspecified'
    }
    if (cause) {
      Object.assign(metadata, cause as Record<string, unknown>)
    }
    log.error('Failed to test Bedrock connectivity.', {
      error,
      metadata
    })
    return {
      success: false,
      error: NOVA_SONIC_CONNECTIVITY_ERROR
    }
  }
}
