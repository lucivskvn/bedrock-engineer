import { toCallConverseApiProps, toRetrieveAndGenerateInput } from '../payload-normalizers'
import type { ValidatedConversePayload, ValidatedRetrieveAndGeneratePayload } from '../validation'

describe('payload normalizers', () => {
  it('sanitizes converse payloads and strips unknown properties', () => {
    const payload: ValidatedConversePayload = {
      modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      messages: [
        {
          role: 'user',
          content: [
            { text: ' hello ', type: 'ignored', unexpected: true } as any,
            {
              toolUse: {
                toolUseId: 'tool-1',
                name: 'web-search',
                input: { query: 'bedrock' },
                extra: 'value'
              }
            } as any,
            {
              toolResult: {
                toolUseId: 'tool-1',
                status: 'success',
                content: [
                  { text: ' result text ', type: 'ignored' },
                  { json: { foo: 'bar' } },
                  { invalid: true }
                ],
                unexpected: 'value'
              }
            } as any
          ]
        }
      ],
      system: [
        { text: 'you are a helpful assistant', type: 'ignored' } as any,
        { text: '   ' } as any
      ],
      toolConfig: { some: 'config' } as any,
      guardrailConfig: { guardrailId: 'abc' } as any,
      inferenceConfig: { maxTokens: 1024 }
    }

    const normalized = toCallConverseApiProps(payload)

    expect(normalized.modelId).toBe(payload.modelId)
    expect(normalized.messages).toHaveLength(1)
    const [message] = normalized.messages
    expect(message.role).toBe('user')
    const messageContent = message.content ?? []
    expect(messageContent).toHaveLength(3)
    expect(messageContent[0]).toEqual({ text: 'hello' })
    expect(messageContent[1]).toEqual({
      toolUse: {
        toolUseId: 'tool-1',
        name: 'web-search',
        input: { query: 'bedrock' }
      }
    })
    expect(messageContent[2]).toEqual({
      toolResult: {
        toolUseId: 'tool-1',
        status: 'success',
        content: [{ text: 'result text' }, { json: { foo: 'bar' } }]
      }
    })
    expect(normalized.system).toEqual([{ text: 'you are a helpful assistant' }])
    expect(normalized.toolConfig).toEqual(payload.toolConfig)
    expect(normalized.guardrailConfig).toEqual(payload.guardrailConfig)
    expect(normalized.inferenceConfig).toEqual(payload.inferenceConfig)
  })

  it('normalizes retrieveAndGenerate payloads', () => {
    const payload: ValidatedRetrieveAndGeneratePayload = {
      sessionId: 'session-123',
      input: { text: 'Tell me about Bedrock.' },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: 'kb-123',
          modelArn: 'arn:aws:bedrock:us-east-1:123456789012:knowledge-base/example',
          extra: 'value'
        }
      },
      sessionConfiguration: {
        kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/example',
        other: 'ignored'
      }
    }

    const normalized = toRetrieveAndGenerateInput(payload)

    expect(normalized.sessionId).toBe('session-123')
    expect(normalized.input).toEqual({ text: 'Tell me about Bedrock.' })
    expect(normalized.sessionConfiguration).toEqual({
      kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/example'
    })
    expect(normalized.retrieveAndGenerateConfiguration).toEqual({
      type: 'KNOWLEDGE_BASE',
      knowledgeBaseConfiguration: {
        knowledgeBaseId: 'kb-123',
        modelArn: 'arn:aws:bedrock:us-east-1:123456789012:knowledge-base/example'
      }
    })
  })

  it('omits invalid tool result content gracefully', () => {
    const payload: ValidatedConversePayload = {
      modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      messages: [
        {
          role: 'assistant',
          content: [
            {
              toolResult: {
                toolUseId: 'tool-2',
                status: 'error',
                content: [{ invalid: true }]
              }
            } as any
          ]
        }
      ],
      system: []
    }

    const normalized = toCallConverseApiProps(payload)
    const resultMessage = normalized.messages[0]
    const resultContent = resultMessage.content ?? []
    const resultBlock = resultContent[0]
    expect(resultBlock).toEqual({
      toolResult: { toolUseId: 'tool-2', status: 'error', content: undefined }
    })
  })
})
