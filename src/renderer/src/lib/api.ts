import { rendererLogger as log } from '@renderer/lib/logger';
import { getTrustedApiEndpoint } from '@renderer/lib/security/apiEndpoint';
import { LLM } from '@/types/llm'
import { RetrieveAndGenerateCommandInput } from '@aws-sdk/client-bedrock-agent-runtime'
import {
  ConverseStreamOutput,
  InferenceConfiguration,
  Message,
  ToolConfiguration
} from '@aws-sdk/client-bedrock-runtime'

export type StreamChatCompletionProps = {
  modelId: string
  system: { text: string }[] | undefined
  messages: Message[]
  toolConfig?: ToolConfiguration
}

const getApiEndpoint = () => getTrustedApiEndpoint()

const withAuthHeaders = (headers: Record<string, string>) => {
  const apiAuthToken = window.store.get('apiAuthToken') as string | undefined
  if (apiAuthToken && apiAuthToken.length > 0) {
    return {
      ...headers,
      'X-API-Key': apiAuthToken
    }
  }
  return headers
}

export async function* streamChatCompletion(
  props: StreamChatCompletionProps,
  abortSignal?: AbortSignal
): AsyncGenerator<ConverseStreamOutput, void, unknown> {
  const endpoint = getApiEndpoint()
  const res = await fetch(`${endpoint}/converse/stream`, {
    method: 'POST',
    body: JSON.stringify(props),
    headers: withAuthHeaders({
      'Content-Type': 'application/json'
    }),
    signal: abortSignal
  })
  const reader = res.body?.getReader()

  if (!reader) {
    throw new Error('Request failed')
  }

  const decoder = new TextDecoder('utf-8')

  if (res.status !== 200) {
    const { value } = await reader.read()
    const msg = decoder.decode(value)
    throw new Error(msg)
  }

  try {
    let done = false
    while (!done) {
      const { done: readDone, value } = await reader.read()
      if (readDone) {
        done = readDone
        reader.releaseLock()
      } else {
        let token = decoder.decode(value, { stream: true })

        const boundary = token.lastIndexOf(`\n`)
        // 2つ以上の JSON オブジェクトが連なっている場合
        if (boundary !== -1) {
          const completeData = token.substring(0, boundary)
          token = token.substring(boundary + 1)

          for (const chunk of completeData.split('\n')) {
            if (chunk) {
              try {
                yield JSON.parse(chunk)
              } catch (e) {
                log.error(`Error parsing JSON:`, e)
              }
            }
          }
        } else {
          yield JSON.parse(token)
        }
      }
    }
  } catch (error) {
    reader.releaseLock()
    throw error
  }
}

type ConverseProps = {
  modelId: string
  system: { text: string }[] | undefined
  messages: Message[]
  toolConfig?: ToolConfiguration
  /**
   * 指定しない場合、グローバル設定値を使用
   */
  inferenceConfig?: InferenceConfiguration
}

export async function converse(props: ConverseProps, abortSignal?: AbortSignal) {
  const endpoint = getApiEndpoint()
  const res = await fetch(`${endpoint}/converse`, {
    method: 'POST',
    body: JSON.stringify(props),
    headers: withAuthHeaders({
      'Content-Type': 'application/json'
    }),
    signal: abortSignal
  })
  return res.json()
}

export async function retrieveAndGenerate(
  props: RetrieveAndGenerateCommandInput,
  abortSignal?: AbortSignal
) {
  const endpoint = getApiEndpoint()
  const res = await fetch(`${endpoint}/retrieveAndGenerate`, {
    method: 'POST',
    body: JSON.stringify(props),
    headers: withAuthHeaders({
      'Content-Type': 'application/json'
    }),
    signal: abortSignal
  })
  return res
}

export async function listModels(): Promise<LLM[]> {
  const endpoint = getApiEndpoint()
  const res = await fetch(`${endpoint}/listModels`, {
    method: 'GET',
    headers: withAuthHeaders({
      'Content-Type': 'application/json'
    })
  })
  return res.json()
}

export async function listAgentTags(): Promise<string[]> {
  const endpoint = getApiEndpoint()
  const res = await fetch(`${endpoint}/listAgentTags`, {
    method: 'GET',
    headers: withAuthHeaders({
      'Content-Type': 'application/json'
    })
  })
  return res.json()
}
