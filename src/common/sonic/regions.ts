export const NOVA_SONIC_SUPPORTED_REGIONS = [
  'us-east-1', // US East (N. Virginia)
  'us-west-2', // US West (Oregon)
  'ap-northeast-1', // Asia Pacific (Tokyo)
  'eu-north-1' // Europe (Stockholm)
] as const

export type NovaSonicSupportedRegion = (typeof NOVA_SONIC_SUPPORTED_REGIONS)[number]

export const DEFAULT_NOVA_SONIC_REGION: NovaSonicSupportedRegion = 'us-east-1'

export const NOVA_SONIC_REGION_UNAVAILABLE_MESSAGE =
  'Nova Sonic is not available in the selected region.'
export const NOVA_SONIC_REGION_CHECK_ERROR = 'Failed to check Nova Sonic region support.'
export const NOVA_SONIC_CONNECTIVITY_ERROR = 'Failed to test Bedrock connectivity.'

export type RegionCheckResult = {
  isSupported: boolean
  currentRegion: string
  supportedRegions: readonly string[]
  error?: string
}

export type ConnectivityTestResult = {
  success: boolean
  error?: string
}

export function isNovaSonicSupportedRegion(
  region: string
): region is NovaSonicSupportedRegion {
  return NOVA_SONIC_SUPPORTED_REGIONS.includes(region as NovaSonicSupportedRegion)
}

export function getNovaSonicSupportedRegions(): readonly string[] {
  return NOVA_SONIC_SUPPORTED_REGIONS
}
