import {
  GuardrailConfiguration,
  InferenceConfiguration,
  Message,
  SystemContentBlock,
  ToolConfiguration
} from '@aws-sdk/client-bedrock-runtime'
// Define minimal store interface locally to avoid importing preload store
export interface ConfigStore {
  get(key: string): any
  set(key: string, value: any): void
}

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

export type AWSCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
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
