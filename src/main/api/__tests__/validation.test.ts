import {
  validateConversePayload,
  validateRetrieveAndGeneratePayload,
  validateRegionParam
} from '../validation'

describe('validateConversePayload', () => {
  const basePayload = {
    modelId: 'claude-3',
    messages: [
      {
        role: 'user',
        content: [
          {
            text: 'Hello world'
          }
        ]
      }
    ],
    system: []
  }

  it('accepts valid payloads', () => {
    const result = validateConversePayload(basePayload)
    expect(result.success).toBe(true)
  })

  it('rejects payloads without messages', () => {
    const result = validateConversePayload({ ...basePayload, messages: [] })
    expect(result.success).toBe(false)
  })

  it('rejects payloads with empty text blocks', () => {
    const result = validateConversePayload({
      ...basePayload,
      messages: [
        {
          role: 'user',
          content: [
            {
              toolUse: {
                toolUseId: 'id',
                name: 'name',
                input: {}
              }
            },
            {}
          ]
        }
      ]
    })
    expect(result.success).toBe(false)
  })

  it('rejects payloads with unsupported roles', () => {
    const result = validateConversePayload({
      ...basePayload,
      messages: [
        {
          role: 'system',
          content: [
            {
              text: 'Not allowed'
            }
          ]
        }
      ]
    })
    expect(result.success).toBe(false)
  })

  it('rejects payloads with blank text content', () => {
    const result = validateConversePayload({
      ...basePayload,
      messages: [
        {
          role: 'user',
          content: [
            {
              text: '   '
            }
          ]
        }
      ]
    })
    expect(result.success).toBe(false)
  })
})

describe('validateRetrieveAndGeneratePayload', () => {
  const basePayload = {
    input: { text: 'Explain retrieval augmented generation.' },
    retrieveAndGenerateConfiguration: {
      type: 'KNOWLEDGE_BASE',
      knowledgeBaseConfiguration: {
        knowledgeBaseId: 'kb-1234567890',
        modelArn: 'arn:aws:bedrock:us-west-2:123456789012:knowledge-base/example'
      }
    }
  }

  it('accepts valid payloads', () => {
    const result = validateRetrieveAndGeneratePayload(basePayload)
    expect(result.success).toBe(true)
  })

  it('rejects payloads without input text', () => {
    const result = validateRetrieveAndGeneratePayload({
      ...basePayload,
      input: { text: '' }
    })
    expect(result.success).toBe(false)
  })

  it('rejects configuration missing type', () => {
    const result = validateRetrieveAndGeneratePayload({
      input: basePayload.input,
      retrieveAndGenerateConfiguration: {
        knowledgeBaseConfiguration: {
          knowledgeBaseId: 'kb-1234567890',
          modelArn: 'arn:aws:bedrock:us-west-2:123456789012:knowledge-base/example'
        }
      }
    })
    expect(result.success).toBe(false)
  })

  it('rejects mismatched configuration type and payload', () => {
    const result = validateRetrieveAndGeneratePayload({
      input: basePayload.input,
      retrieveAndGenerateConfiguration: {
        type: 'EXTERNAL_SOURCES',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: 'kb-1234567890',
          modelArn: 'arn:aws:bedrock:us-west-2:123456789012:knowledge-base/example'
        }
      }
    })
    expect(result.success).toBe(false)
  })

  it('rejects external sources configuration without sources data', () => {
    const result = validateRetrieveAndGeneratePayload({
      input: basePayload.input,
      retrieveAndGenerateConfiguration: {
        type: 'EXTERNAL_SOURCES'
      }
    })
    expect(result.success).toBe(false)
  })
})

describe('validateRegionParam', () => {
  it('returns success when region is undefined', () => {
    const result = validateRegionParam(undefined)
    expect(result.success).toBe(true)
    expect(result.data).toBeUndefined()
  })

  it('accepts valid AWS regions', () => {
    const result = validateRegionParam('us-west-2')
    expect(result.success).toBe(true)
    expect(result.data).toBe('us-west-2')
  })

  it('rejects malformed regions', () => {
    const result = validateRegionParam('../etc/passwd')
    expect(result.success).toBe(false)
  })
})
