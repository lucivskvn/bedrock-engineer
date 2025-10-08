import { z } from 'zod'

const MAX_MODEL_ID_LENGTH = 256
const MAX_TEXT_LENGTH = 16_000
const MAX_MESSAGES = 64
const MAX_CONTENT_BLOCKS = 32
const MAX_SYSTEM_BLOCKS = 16
const MAX_SESSION_ID_LENGTH = 512
const REGION_PATTERN = /^[a-z]{2}-[a-z0-9-]+-\d$/
const ALLOWED_MESSAGE_ROLES = ['assistant', 'user'] as const

const toolUseSchema = z
  .object({
    toolUseId: z.string().min(1).max(256),
    name: z.string().min(1).max(128),
    input: z.unknown()
  })
  .catchall(z.any())

const toolResultSchema = z
  .object({
    toolUseId: z.string().min(1).max(256),
    status: z.string().max(32).optional(),
    content: z
      .array(
        z
          .object({
            text: z.string().max(MAX_TEXT_LENGTH).optional(),
            type: z.string().max(32).optional()
          })
          .catchall(z.any())
      )
      .max(MAX_CONTENT_BLOCKS)
      .optional()
  })
  .catchall(z.any())

const contentBlockSchema = z
  .object({
    text: z
      .string()
      .max(MAX_TEXT_LENGTH)
      .optional(),
    type: z.string().max(32).optional(),
    toolUse: toolUseSchema.optional(),
    toolResult: toolResultSchema.optional()
  })
  .catchall(z.any())
  .superRefine((value, ctx) => {
    if (!value.text && !value.toolUse && !value.toolResult) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'content block must include text, toolUse or toolResult'
      })
    }

    if (typeof value.text === 'string' && value.text.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'text content must not be blank'
      })
    }
  })

const messageSchema = z
  .object({
    role: z.enum(ALLOWED_MESSAGE_ROLES),
    content: z.array(contentBlockSchema).min(1).max(MAX_CONTENT_BLOCKS)
  })
  .catchall(z.any())

const systemBlockSchema = z
  .object({
    text: z
      .string()
      .min(1, 'system text must not be empty')
      .max(MAX_TEXT_LENGTH),
    type: z.string().max(32).optional()
  })
  .catchall(z.any())

export const callConverseSchema = z
  .object({
    modelId: z
      .string()
      .min(1, 'modelId is required')
      .max(MAX_MODEL_ID_LENGTH, `modelId must be <= ${MAX_MODEL_ID_LENGTH} characters`),
    messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
    system: z.array(systemBlockSchema).max(MAX_SYSTEM_BLOCKS).optional(),
    toolConfig: z.unknown().optional(),
    guardrailConfig: z.unknown().optional(),
    inferenceConfig: z
      .object({
        maxTokens: z.number().int().positive().max(8192).optional(),
        temperature: z.number().min(0).max(2).optional(),
        topP: z.number().min(0).max(1).optional()
      })
      .catchall(z.any())
      .optional()
  })
  .catchall(z.any())

export type ValidatedConversePayload = z.infer<typeof callConverseSchema>

export function validateConversePayload(payload: unknown) {
  return callConverseSchema.safeParse(payload)
}

const retrieveAndGenerateConfigurationSchema = z
  .object({
    type: z.enum(['KNOWLEDGE_BASE', 'EXTERNAL_SOURCES']),
    knowledgeBaseConfiguration: z
      .object({
        knowledgeBaseId: z.string().min(1).max(MAX_MODEL_ID_LENGTH),
        modelArn: z.string().min(1).max(2048)
      })
      .catchall(z.any())
      .optional(),
    externalSourcesConfiguration: z
      .object({
        modelArn: z.string().max(2048),
        sources: z.array(z.unknown()).max(25).optional()
      })
      .catchall(z.any())
      .optional()
  })
  .catchall(z.any())
  .superRefine((value, ctx) => {
    if (value.type === 'KNOWLEDGE_BASE') {
      if (!value.knowledgeBaseConfiguration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'knowledgeBaseConfiguration is required when type is KNOWLEDGE_BASE'
        })
      }
      if (value.externalSourcesConfiguration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'externalSourcesConfiguration is not allowed when type is KNOWLEDGE_BASE'
        })
      }
    }

    if (value.type === 'EXTERNAL_SOURCES') {
      if (!value.externalSourcesConfiguration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'externalSourcesConfiguration is required when type is EXTERNAL_SOURCES'
        })
      }
      if (value.knowledgeBaseConfiguration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'knowledgeBaseConfiguration is not allowed when type is EXTERNAL_SOURCES'
        })
      }
    }
  })

const retrieveAndGenerateSchema = z
  .object({
    sessionId: z
      .string()
      .min(1)
      .max(MAX_SESSION_ID_LENGTH)
      .optional(),
    input: z.object({
      text: z
        .string()
        .min(1)
        .max(MAX_TEXT_LENGTH)
    }),
    retrieveAndGenerateConfiguration: retrieveAndGenerateConfigurationSchema.optional(),
    sessionConfiguration: z
      .object({
        kmsKeyArn: z.string().max(2048)
      })
      .catchall(z.any())
      .optional()
  })
  .catchall(z.any())

export function validateRetrieveAndGeneratePayload(payload: unknown) {
  return retrieveAndGenerateSchema.safeParse(payload)
}

export type ValidatedRetrieveAndGeneratePayload = z.infer<typeof retrieveAndGenerateSchema>

const regionSchema = z.string().regex(REGION_PATTERN, 'region must follow aws naming convention').max(64)

export function validateRegionParam(region: unknown) {
  if (region === undefined) {
    return { success: true as const, data: undefined }
  }
  const result = regionSchema.safeParse(region)
  if (!result.success) {
    return result
  }
  return { success: true as const, data: result.data }
}
