import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { BedrockClient } from '@aws-sdk/client-bedrock'
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime'
import { TranslateClient } from '@aws-sdk/client-translate'
// import { fromIni } from '@aws-sdk/credential-providers' // No longer needed for profile handling here
import { NovaSonicBidirectionalStreamClient } from '../sonic/client'
import type { AwsClientConfig } from './types' // Changed from AWSCredentials
import { S3Client } from '@aws-sdk/client-s3'
import { createHttpOptions } from '../../lib/proxy-utils'

export function createS3Client(clientConfig: AwsClientConfig) {
  const { region } = clientConfig
  const httpOptions = createHttpOptions(clientConfig)

  // Credentials and profile are now handled by the default provider chain
  return new S3Client({
    region,
    ...httpOptions
  })
}

export function createRuntimeClient(clientConfig: AwsClientConfig) {
  const { region } = clientConfig
  const httpOptions = createHttpOptions(clientConfig)

  // Credentials and profile are now handled by the default provider chain
  return new BedrockRuntimeClient({
    region,
    ...httpOptions
  })
}

export function createBedrockClient(clientConfig: AwsClientConfig) {
  const { region } = clientConfig
  const httpOptions = createHttpOptions(clientConfig)

  // Credentials and profile are now handled by the default provider chain
  return new BedrockClient({
    region,
    ...httpOptions
  })
}

export function createAgentRuntimeClient(clientConfig: AwsClientConfig) {
  const { region } = clientConfig
  const httpOptions = createHttpOptions(clientConfig)

  // Credentials and profile are now handled by the default provider chain
  return new BedrockAgentRuntimeClient({
    region,
    ...httpOptions
  })
}

export function createNovaSonicClient(clientConfigParam: AwsClientConfig) {
  const { region } = clientConfigParam
  const httpOptions = createHttpOptions(clientConfigParam)

  // Credentials (including those from profiles via fromIni) are now handled by the default provider chain.
  // The SDK's default provider chain will automatically look for AWS_PROFILE env var or default profile.
  const novaClientConfig = {
    region,
    ...httpOptions
    // No explicit credentials or profile handling here
  }

  return new NovaSonicBidirectionalStreamClient({
    requestHandlerConfig: {
      maxConcurrentStreams: 10
    },
    clientConfig: novaClientConfig
  })
}

export function createTranslateClient(clientConfig: AwsClientConfig) {
  const { region } = clientConfig
  const httpOptions = createHttpOptions(clientConfig)

  // Credentials and profile are now handled by the default provider chain
  return new TranslateClient({
    region,
    ...httpOptions
  })
}
