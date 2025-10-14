import {
  ApplyGuardrailCommand,
  ApplyGuardrailCommandInput,
  ApplyGuardrailCommandOutput,
  ApplyGuardrailRequest
} from '@aws-sdk/client-bedrock-runtime'
import { createRuntimeClient } from '../client'
import { createCategoryLogger } from '../../../../common/logger'
import type { ServiceContext } from '../types'

// Create category logger for guardrail service
const guardrailLogger = createCategoryLogger('bedrock:guardrail')

/**
 * Bedrock Guardrail APIと連携するサービスクラス
 * ガードレールのテキストコンテンツ評価を担当
 */
export class GuardrailService {
  private static readonly MAX_RETRIES = 3
  private static readonly RETRY_DELAY = 1000

  constructor(private context: ServiceContext) {}

  /**
   * ガードレール評価を適用する
   * @param request ガードレール評価リクエスト
   * @returns ガードレール評価結果
   */
  async applyGuardrail(
    request: ApplyGuardrailRequest,
    retries = 0
  ): Promise<ApplyGuardrailCommandOutput> {
    try {
      // リクエストパラメータの準備
      // AWS SDK の ApplyGuardrailCommandInput の実際の型に合わせた準備
      const commandParams: ApplyGuardrailCommandInput = {
        guardrailIdentifier: request.guardrailIdentifier,
        guardrailVersion: request.guardrailVersion,
        content: request.content,
        source: request.source
      }

      const runtimeClient = createRuntimeClient(this.context.store.get('aws'))
      const awsConfig = this.context.store.get('aws')

      // APIリクエスト前にログ出力
      guardrailLogger.debug('Sending apply guardrail request', {
        guardrailId: request.guardrailIdentifier,
        guardrailVersion: request.guardrailVersion,
        region: awsConfig.region
      })

      // APIリクエストを送信
      const command = new ApplyGuardrailCommand(commandParams)
      return await runtimeClient.send(command)
    } catch (error: any) {
      return this.handleError(error, request, retries)
    }
  }

  /**
   * エラー処理を行う
   */
  private async handleError(
    error: any,
    request: ApplyGuardrailRequest,
    retries: number
  ): Promise<ApplyGuardrailCommandOutput> {
    // スロットリングまたはサービス利用不可の場合
    if (error.name === 'ThrottlingException' || error.name === 'ServiceUnavailableException') {
      guardrailLogger.warn('Guardrail apply request throttled or unavailable', {
        retry: retries,
        errorName: error.name,
        message: error.message,
        guardrailId: request.guardrailIdentifier
      })

      // 最大リトライ回数を超えた場合はエラーをスロー
      if (retries >= GuardrailService.MAX_RETRIES) {
        guardrailLogger.error('Maximum retries reached for Bedrock API request', {
          maxRetries: GuardrailService.MAX_RETRIES,
          errorName: error.name,
          guardrailId: request.guardrailIdentifier
        })
        throw error
      }

      // 待機してから再試行
      await new Promise((resolve) => setTimeout(resolve, GuardrailService.RETRY_DELAY))
      return this.applyGuardrail(request, retries + 1)
    }

    // バリデーションエラーの場合
    if (error.name === 'ValidationException') {
      guardrailLogger.error('Guardrail apply validation failure', {
        errorMessage: error.message,
        errorDetails: error.$metadata,
        guardrailId: request.guardrailIdentifier
      })
    } else {
      // その他のエラー
      guardrailLogger.error('Guardrail apply request failed', {
        errorName: error.name,
        errorMessage: error.message,
        guardrailId: request.guardrailIdentifier,
        stack: error.stack
      })
    }

    throw error
  }
}
