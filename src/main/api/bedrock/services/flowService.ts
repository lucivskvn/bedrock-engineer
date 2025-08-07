import {
  InvokeFlowCommand,
  InvokeFlowCommandInput,
  InvokeFlowCommandOutput,
  FlowResponseStream,
  FlowCompletionEvent as SDKFlowCompletionEvent,
  FlowOutputEvent as SDKFlowOutputEvent,
  FlowMultiTurnInputRequestEvent as SDKFlowMultiTurnInputRequestEvent,
  FlowTraceEvent
} from '@aws-sdk/client-bedrock-agent-runtime'
import { createAgentRuntimeClient } from '../client'
import type { ServiceContext } from '../types'
import { log } from '../../../../common/logger'

export type InvokeFlowInput = {
  flowIdentifier: string
  flowAliasIdentifier: string
  inputs: Array<{
    content: {
      document: string
    }
    nodeName: string
    nodeOutputName: string
  }>
  enableTrace?: boolean
}

export type FlowOutput = {
  content: {
    document: string
  }
  nodeName: string
  nodeOutputName: string
}

export type FlowResponseEvent = {
  flowCompletionEvent?: SDKFlowCompletionEvent
  flowOutputEvent?: SDKFlowOutputEvent
  flowMultiTurnInputRequestEvent?: SDKFlowMultiTurnInputRequestEvent
  flowTraceEvent?: FlowTraceEvent
}

export type InvokeFlowResult = {
  $metadata: InvokeFlowCommandOutput['$metadata']
  executionId: string
  flowStatus?: string
  outputs: FlowOutput[]
  events: FlowResponseEvent[]
  requiresInput?: boolean
  promptId?: string
  inputNodeName?: string
}

export class FlowService {
  constructor(private context: ServiceContext) {}

  async invokeFlow(params: InvokeFlowInput): Promise<InvokeFlowResult> {
    const agentClient = createAgentRuntimeClient(this.context.store.get('aws'))
    const { flowIdentifier, flowAliasIdentifier, inputs, enableTrace = false } = params

    const commandInput: InvokeFlowCommandInput = {
      flowIdentifier,
      flowAliasIdentifier,
      inputs,
      enableTrace
    }

    const command = new InvokeFlowCommand(commandInput)

    try {
      const response = await agentClient.send(command)

      // レスポンスストリームを処理
      const processedResponse = await this.processResponseStream(response.responseStream)

      return {
        $metadata: response.$metadata,
        executionId: response.executionId || '',
        ...processedResponse
      }
    } catch (error) {
      log.error('Error invoking flow:', error)
      throw error
    }
  }

  // レスポンスストリームを処理するメソッド
  private async processResponseStream(stream?: AsyncIterable<FlowResponseStream>): Promise<{
    flowStatus?: string
    outputs: FlowOutput[]
    events: FlowResponseEvent[]
    requiresInput?: boolean
    promptId?: string
    inputNodeName?: string
  }> {
    if (!stream) {
      return { outputs: [], events: [] }
    }

    const outputs: FlowOutput[] = []
    const events: FlowResponseEvent[] = []
    let flowStatus: string | undefined
    let requiresInput = false
    let promptId: string | undefined
    let inputNodeName: string | undefined

    try {
      for await (const streamChunk of stream) {
        const responseEvent: FlowResponseEvent = {}

        // Flow完了イベントの処理
        if ('flowCompletionEvent' in streamChunk && streamChunk.flowCompletionEvent) {
          responseEvent.flowCompletionEvent = streamChunk.flowCompletionEvent
          flowStatus = streamChunk.flowCompletionEvent.completionReason || 'COMPLETED'

          // 出力結果の処理 - AWS SDKの型に合わせて安全にアクセス
          const outputResults = (streamChunk.flowCompletionEvent as any).outputResults
          if (outputResults && Array.isArray(outputResults)) {
            for (const result of outputResults) {
              if (result.output) {
                const output = result.output
                outputs.push({
                  content: {
                    document:
                      typeof output.content?.document === 'string'
                        ? output.content.document
                        : JSON.stringify(output.content?.document) || ''
                  },
                  nodeName: output.nodeName || '',
                  nodeOutputName: output.nodeOutputName || ''
                })
              }
            }
          }
        }

        // 出力イベントの処理
        if ('flowOutputEvent' in streamChunk && streamChunk.flowOutputEvent) {
          responseEvent.flowOutputEvent = streamChunk.flowOutputEvent
          if (streamChunk.flowOutputEvent.content && streamChunk.flowOutputEvent.nodeName) {
            const document = streamChunk.flowOutputEvent.content.document
            outputs.push({
              content: {
                document: typeof document === 'string' ? document : JSON.stringify(document) || ''
              },
              nodeName: streamChunk.flowOutputEvent.nodeName,
              // nodeOutputNameがない場合はデフォルト値を使用
              nodeOutputName: (streamChunk.flowOutputEvent as any).nodeOutputName || 'document'
            })
          }
        }

        // マルチターン入力リクエストイベントの処理
        if (
          'flowMultiTurnInputRequestEvent' in streamChunk &&
          streamChunk.flowMultiTurnInputRequestEvent
        ) {
          responseEvent.flowMultiTurnInputRequestEvent = streamChunk.flowMultiTurnInputRequestEvent
          requiresInput = true

          // AWS SDKの型定義に合わせて安全にアクセス
          const inputPrompt = (streamChunk.flowMultiTurnInputRequestEvent as any).inputPrompt
          if (inputPrompt && inputPrompt.promptId) {
            promptId = inputPrompt.promptId
          }
          inputNodeName = streamChunk.flowMultiTurnInputRequestEvent.nodeName || undefined
        }

        // トレースイベントの処理
        if ('flowTraceEvent' in streamChunk && streamChunk.flowTraceEvent) {
          responseEvent.flowTraceEvent = streamChunk.flowTraceEvent
        }

        // イベントを記録
        if (Object.keys(responseEvent).length > 0) {
          events.push(responseEvent)
        }
      }
    } catch (error: any) {
      log.error('Error processing response stream:', error)

      // セッションコンテキストエラーの場合は特別なハンドリング
      if (
        error.name === 'ValidationException' &&
        error.message &&
        error.message.includes('Error retrieving session context')
      ) {
        // セッションが期限切れまたは無効な場合は空の結果を返す
        return {
          flowStatus: 'SESSION_ERROR',
          outputs: [],
          events: [],
          requiresInput: false
        }
      }

      throw error
    }

    return {
      flowStatus,
      outputs,
      events,
      requiresInput,
      promptId,
      inputNodeName
    }
  }
}
