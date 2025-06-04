import express, { Request, Response, ErrorRequestHandler } from 'express'
import cors from 'cors'
import { RequestHandler, NextFunction } from 'express'
import { RetrieveAndGenerateCommandInput } from '@aws-sdk/client-bedrock-agent-runtime'
import { BedrockService, CallConverseAPIProps } from './bedrock'
import { store } from '../../preload/store'
import { createCategoryLogger } from '../../common/logger'

// Create category logger for API
const apiLogger = createCategoryLogger('api:express')
const bedrockLogger = createCategoryLogger('api:bedrock')

export const bedrock = new BedrockService({ store })

interface PromiseRequestHandler {
  (req: Request, res: Response, next: NextFunction): Promise<unknown>
}

function wrap(fn: PromiseRequestHandler): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next).then<void>(() => {})
}

// Error handling middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  apiLogger.error('Express error', {
    path: req.path,
    method: req.method,
    error: err instanceof Error ? err.stack : String(err)
  })

  res.status(500).json({
    error: {
      message: err instanceof Error ? err.message : String(err)
    }
  })
}

// アプリケーションで動作するようにdotenvを設定する
const api = express()

const allowedOrigins = ['http://localhost:5173']
api.use(
  cors({
    origin: allowedOrigins
  })
)
api.use(express.json({ limit: '10mb' }))
api.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Add request logging
api.use((req, res, next) => {
  const start = Date.now()

  // Log when response is finished
  res.on('finish', () => {
    const duration = Date.now() - start
    apiLogger.debug(`${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    })
  })

  next()
})

api.get('/', (_req: Request, res: Response) => {
  res.send('Hello World')
})

interface CustomRequest<T> extends Request {
  body: T
}

type ConverseStreamRequest = CustomRequest<CallConverseAPIProps>

api.post(
  '/converse/stream',
  wrap(async (req: ConverseStreamRequest, res) => {
    res.setHeader('Content-Type', 'text/event-stream;charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')

    try {
      const result = await bedrock.converseStream(req.body)

      if (!result.stream) {
        return res.end()
      }

      for await (const item of result.stream) {
        res.write(JSON.stringify(item) + '\n')
      }
    } catch (error: any) {
      bedrockLogger.error('Stream conversation error', {
        errorName: error.name,
        message: error.message,
        stack: error.stack,
        modelId: req.body.modelId
      })

      if (error.name === 'ValidationException') {
        return res.status(400).send({
          ...error,
          message: error.message
        })
      }

      return res.status(500).send(error)
    }

    return res.end()
  })
)

type ConverseRequest = CustomRequest<CallConverseAPIProps>

api.post(
  '/converse',
  wrap(async (req: ConverseRequest, res) => {
    res.setHeader('Content-Type', 'application/json')

    try {
      const result = await bedrock.converse(req.body)
      return res.json(result)
    } catch (error: any) {
      bedrockLogger.error('Conversation error', {
        errorName: error.name,
        message: error.message,
        stack: error.stack,
        modelId: req.body.modelId
      })
      return res.status(500).send(error)
    }
  })
)

type RetrieveAndGenerateCommandInputRequest = CustomRequest<RetrieveAndGenerateCommandInput>

api.post(
  '/retrieveAndGenerate',
  wrap(async (req: RetrieveAndGenerateCommandInputRequest, res) => {
    res.setHeader('Content-Type', 'application/json')
    try {
      const result = await bedrock.retrieveAndGenerate(req.body)
      return res.json(result)
    } catch (error: any) {
      bedrockLogger.error('RetrieveAndGenerate error', {
        errorName: error.name,
        message: error.message,
        stack: error.stack,
        // Type safety: knowledgeBaseId is accessed differently in RetrieveAndGenerateCommandInput
        knowledgeBaseId: (req.body as any).knowledgeBaseId || 'unknown'
      })

      if (error.name === 'ResourceNotFoundException') {
        return res.status(404).send({
          ...error,
          message: error.message
        })
      }
      return res.status(500).send(error)
    }
  })
)

api.get(
  '/listModels',
  wrap(async (_req: Request, res) => {
    res.setHeader('Content-Type', 'application/json')
    try {
      const result = await bedrock.listModels()
      return res.json(result)
    } catch (error: any) {
      bedrockLogger.error('ListModels error', {
        errorName: error.name,
        message: error.message,
        stack: error.stack
      })
      return res.status(500).send(error)
    }
  })
)

// Add error handling middleware last
api.use(errorHandler)

export default api
