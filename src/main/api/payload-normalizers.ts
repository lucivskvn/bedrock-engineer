import type {
  ContentBlock,
  Message,
  SystemContentBlock,
  ToolResultBlock,
  ToolResultContentBlock,
  ToolUseBlock
} from '@aws-sdk/client-bedrock-runtime'
import { ToolResultStatus } from '@aws-sdk/client-bedrock-runtime'
import type { DocumentType } from '@smithy/types'
import type { RetrieveAndGenerateCommandInput, RetrieveAndGenerateConfiguration } from '@aws-sdk/client-bedrock-agent-runtime'
import type { CallConverseAPIProps } from './bedrock'
import type {
  ValidatedConversePayload,
  ValidatedRetrieveAndGeneratePayload
} from './validation'

function sanitizeTextBlock(text?: unknown): ContentBlock | undefined {
  if (typeof text !== 'string') {
    return undefined
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  return { text: trimmed }
}

const TOOL_RESULT_STATUS_VALUES = new Set<string>(Object.values(ToolResultStatus))

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isDocumentType(value: unknown): value is DocumentType {
  if (value === null) {
    return true
  }

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return true
    case 'object':
      if (value instanceof Uint8Array) {
        return true
      }
      if (Array.isArray(value)) {
        return value.every(isDocumentType)
      }
      if (isPlainObject(value)) {
        return Object.values(value).every(isDocumentType)
      }
      return false
    default:
      return false
  }
}

function sanitizeToolUseBlock(block: {
  toolUse?: { toolUseId?: unknown; name?: unknown; input?: unknown }
}): ContentBlock | undefined {
  const toolUse = block.toolUse
  if (!toolUse) {
    return undefined
  }
  const { toolUseId, name, input } = toolUse
  if (typeof toolUseId !== 'string' || typeof name !== 'string') {
    return undefined
  }

  const sanitized: ToolUseBlock = {
    toolUseId,
    name,
    input: isDocumentType(input) ? input : undefined
  }

  return { toolUse: sanitized }
}

function sanitizeToolResultContent(items: unknown): ToolResultContentBlock[] {
  if (!Array.isArray(items)) {
    return []
  }

  const result: ToolResultContentBlock[] = []
  for (const item of items) {
    if (item && typeof item === 'object' && typeof (item as any).text === 'string') {
      const trimmed = ((item as any).text as string).trim()
      if (trimmed.length > 0) {
        result.push({ text: trimmed })
      }
    } else if (item && typeof item === 'object' && (item as any).json !== undefined) {
      result.push({ json: (item as any).json })
    }
  }
  return result
}

function sanitizeToolResultBlock(block: {
  toolResult?: { toolUseId?: unknown; status?: unknown; content?: unknown }
}): ContentBlock | undefined {
  const toolResult = block.toolResult
  if (!toolResult || typeof toolResult !== 'object') {
    return undefined
  }

  const { toolUseId, status, content } = toolResult as Record<string, unknown>
  if (typeof toolUseId !== 'string') {
    return undefined
  }

  const sanitizedContent = sanitizeToolResultContent(content)
  const sanitizedStatus =
    typeof status === 'string' && TOOL_RESULT_STATUS_VALUES.has(status)
      ? (status as ToolResultStatus)
      : undefined
  const sanitized: ToolResultBlock = {
    toolUseId,
    status: sanitizedStatus,
    content: sanitizedContent.length > 0 ? sanitizedContent : undefined
  }

  return { toolResult: sanitized }
}

function sanitizeMessageContent(
  contentBlocks: ValidatedConversePayload['messages'][number]['content']
): ContentBlock[] {
  const sanitized = contentBlocks
    .map((block) => {
      return (
        sanitizeTextBlock(block.text) || sanitizeToolUseBlock(block) || sanitizeToolResultBlock(block)
      )
    })
    .filter((block): block is ContentBlock => Boolean(block))

  if (sanitized.length === 0) {
    throw new Error('Message content is empty after sanitization')
  }

  return sanitized
}

function sanitizeMessages(payload: ValidatedConversePayload): Message[] {
  return payload.messages.map((message) => ({
    role: message.role,
    content: sanitizeMessageContent(message.content)
  }))
}

function sanitizeSystemBlocks(payload: ValidatedConversePayload): SystemContentBlock[] {
  const systemBlocks = payload.system ?? []
  return systemBlocks
    .map((block) => sanitizeTextBlock(block.text))
    .filter((block): block is ContentBlock => Boolean(block))
    .map((block) => ({ text: block.text! }))
}

export function toCallConverseApiProps(payload: ValidatedConversePayload): CallConverseAPIProps {
  const messages = sanitizeMessages(payload)
  const system = sanitizeSystemBlocks(payload)

  const result: CallConverseAPIProps = {
    modelId: payload.modelId,
    messages,
    system
  }

  if (payload.toolConfig) {
    result.toolConfig = payload.toolConfig as CallConverseAPIProps['toolConfig']
  }

  if (payload.guardrailConfig) {
    result.guardrailConfig = payload.guardrailConfig as CallConverseAPIProps['guardrailConfig']
  }

  if (payload.inferenceConfig) {
    result.inferenceConfig = payload.inferenceConfig as CallConverseAPIProps['inferenceConfig']
  }

  return result
}

function sanitizeRetrieveAndGenerateConfiguration(
  config: ValidatedRetrieveAndGeneratePayload['retrieveAndGenerateConfiguration']
): RetrieveAndGenerateConfiguration | undefined {
  if (!config) {
    return undefined
  }

  if (config.type === 'KNOWLEDGE_BASE' && config.knowledgeBaseConfiguration) {
    const { knowledgeBaseId, modelArn } = config.knowledgeBaseConfiguration as Record<string, unknown>
    if (typeof knowledgeBaseId === 'string' && typeof modelArn === 'string') {
      return {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: { knowledgeBaseId, modelArn }
      }
    }
    return undefined
  }

  if (config.type === 'EXTERNAL_SOURCES' && config.externalSourcesConfiguration) {
    const externalConfig = config.externalSourcesConfiguration as Record<string, unknown>
    const { modelArn, sources } = externalConfig
    if (typeof modelArn !== 'string') {
      return undefined
    }
    return {
      type: 'EXTERNAL_SOURCES',
      externalSourcesConfiguration: {
        modelArn,
        sources: Array.isArray(sources) ? sources : undefined
      }
    }
  }

  return undefined
}

export function toRetrieveAndGenerateInput(
  payload: ValidatedRetrieveAndGeneratePayload
): RetrieveAndGenerateCommandInput {
  const request: RetrieveAndGenerateCommandInput = {
    input: { text: payload.input.text }
  }

  if (typeof payload.sessionId === 'string') {
    request.sessionId = payload.sessionId
  }

  const sanitizedConfig = sanitizeRetrieveAndGenerateConfiguration(payload.retrieveAndGenerateConfiguration)
  if (sanitizedConfig) {
    request.retrieveAndGenerateConfiguration = sanitizedConfig
  }

  if (payload.sessionConfiguration && typeof payload.sessionConfiguration === 'object') {
    const { kmsKeyArn } = payload.sessionConfiguration as Record<string, unknown>
    if (typeof kmsKeyArn === 'string' && kmsKeyArn.trim().length > 0) {
      request.sessionConfiguration = { kmsKeyArn }
    }
  }

  return request
}
