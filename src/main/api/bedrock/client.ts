import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { BedrockClient } from '@aws-sdk/client-bedrock'
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime'
import { TranslateClient } from '@aws-sdk/client-translate'
import { fromIni } from '@aws-sdk/credential-providers'
import type { AWSCredentials } from './types'
import { S3Client } from '@aws-sdk/client-s3'
import { createHttpOptions } from '../../lib/proxy-utils'

export function createS3Client(awsCredentials: AWSCredentials) {
  const { region, useProfile, profile, ...credentials } = awsCredentials
  const httpOptions = createHttpOptions(awsCredentials)

  if (useProfile) {
    return new S3Client({
      region,
      profile,
      ...httpOptions
    })
  }

  return new S3Client({
    region,
    credentials,
    ...httpOptions
  })
}

export function createRuntimeClient(awsCredentials: AWSCredentials) {
  const { region, useProfile, profile, ...credentials } = awsCredentials
  const httpOptions = createHttpOptions(awsCredentials)

  if (useProfile) {
    return new BedrockRuntimeClient({
      region,
      profile,
      ...httpOptions
    })
  }

  return new BedrockRuntimeClient({
    region,
    credentials,
    ...httpOptions
  })
}

export function createBedrockClient(awsCredentials: AWSCredentials) {
  const { region, useProfile, profile, ...credentials } = awsCredentials
  const httpOptions = createHttpOptions(awsCredentials)

  if (useProfile) {
    return new BedrockClient({
      region,
      profile,
      ...httpOptions
    })
  }

  return new BedrockClient({
    region,
    credentials,
    ...httpOptions
  })
}

export function createAgentRuntimeClient(awsCredentials: AWSCredentials) {
  const { region, useProfile, profile, ...credentials } = awsCredentials
  const httpOptions = createHttpOptions(awsCredentials)

  if (useProfile) {
    return new BedrockAgentRuntimeClient({
      region,
      profile,
      ...httpOptions
    })
  }

  return new BedrockAgentRuntimeClient({
    region,
    credentials,
    ...httpOptions
  })
}

export function createNovaSonicClient(awsCredentials: AWSCredentials) {
  // Lazily require to avoid loading heavy dependencies when not needed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NovaSonicBidirectionalStreamClient } = require('../sonic/client')
  const { region, useProfile, profile, ...credentials } = awsCredentials
  const httpOptions = createHttpOptions(awsCredentials)

  const clientConfig = useProfile
    ? { region, credentials: fromIni({ profile }), ...httpOptions }
    : { region, credentials, ...httpOptions }

  return new NovaSonicBidirectionalStreamClient({
    requestHandlerConfig: {
      maxConcurrentStreams: 10
    },
    clientConfig
  })
}

export function createTranslateClient(awsCredentials: AWSCredentials) {
  const { region, useProfile, profile, ...credentials } = awsCredentials
  const httpOptions = createHttpOptions(awsCredentials)

  if (useProfile) {
    return new TranslateClient({
      region,
      profile,
      ...httpOptions
    })
  }

  return new TranslateClient({
    region,
    credentials,
    ...httpOptions
  })
}
