import {
  GuardrailConfiguration,
  InferenceConfiguration,
  Message,
  SystemContentBlock,
  ToolConfiguration
} from '@aws-sdk/client-bedrock-runtime'
import { ConfigStore } from '../../../preload/store'

export type CallConverseAPIProps = {
  modelId: string
  messages: Message[]
  system: SystemContentBlock[]
  toolConfig?: ToolConfiguration
  guardrailConfig?: GuardrailConfiguration
  inferenceConfig?: InferenceConfiguration
}

export type ProxyConfiguration = {
  enabled: boolean
  host?: string
  port?: number
  username?: string
  password?: string
  protocol?: 'http' | 'https'
}

export type ProxySettings = {
  proxyConfig?: ProxyConfiguration
}

// This type holds non-credential configuration needed for AWS clients and general AWS settings.
// It is used by the SDK client factory functions and for storing AWS-related settings in electron-store.
export type AwsClientConfig = {
  region: string
  profile?: string // User might specify a profile name
  // useProfile is implicitly true if 'profile' is set by the user, SDK handles this.
  proxyConfig?: ProxyConfiguration
}

// The AWSCredentials type is being phased out for storing actual credentials.
// For the store, we will use AwsClientConfig.
// If other parts of the app were hypothetically handling raw credentials before SDK involvement,
// they would need significant refactoring. Our goal is to remove such patterns.
// For clarity during transition, I'm renaming AWSCredentials to OldAWSCredentialsConfig
// and will remove its usages where it implies storing actual keys.
export type OldAWSCredentialsConfig = {
  accessKeyId: string // To be removed from active use
  secretAccessKey: string // To be removed from active use
  sessionToken?: string // To be removed from active use
  region: string
  profile?: string
  useProfile?: boolean
  proxyConfig?: ProxyConfiguration
}

export interface ThinkingMode {
  type: 'enabled' | 'disabled'
  budget_tokens?: number
}

export type InferenceParams = {
  maxTokens: number
  temperature: number
  topP?: number
  thinking?: ThinkingMode
}

export type ServiceContext = {
  store: ConfigStore
}
