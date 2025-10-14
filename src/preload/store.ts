import Store, { type Options as ElectronStoreOptions } from 'electron-store'
import keytar from 'keytar'
import { randomBytes } from 'crypto'
import { promises as fs, constants as fsConstants } from 'fs'
import path from 'path'
import os from 'os'
import { LLM, InferenceParameters, ThinkingMode, ThinkingModeBudget } from '../types/llm'
import {
  AgentChatConfig,
  KnowledgeBase,
  SendMsgKey,
  ToolState,
  OrganizationConfig
} from '../types/agent-chat'
import { CustomAgent } from '../types/agent-chat'
import { BedrockAgent } from '../types/agent'
import { AWSCredentials, ProxyConfiguration } from '../main/api/bedrock/types'
import { CodeInterpreterContainerConfig } from './tools/handlers/interpreter/types'
import { log } from './logger'
import { normalizeApiToken, MIN_API_TOKEN_LENGTH } from '../common/security'
import { createStructuredError } from '../common/errors'
import { isSystemRootDirectory } from '../common/security/pathGuards'
import { normalizeNetworkEndpoint } from '../common/security/urlGuards'

const KEYCHAIN_SERVICE = 'bedrock-engineer'
const KEYCHAIN_ACCESS_ID = 'awsAccessKeyId'
const KEYCHAIN_SECRET = 'awsSecretAccessKey'
const KEYCHAIN_SESSION = 'awsSessionToken'
const KEYCHAIN_ENCRYPTION_KEY = 'storeEncryptionKey'
const FALLBACK_ENCRYPTION_FILENAME = 'secure-store.key'
const FALLBACK_AWS_CREDENTIALS_KEY = '__secureAwsCredentials'

let keytarAvailable = true

const TAVILY_API_KEY_PATTERN = /^tvly-[A-Za-z0-9]{20,}$/

const AWS_ACCESS_KEY_PATTERN = /^[A-Z0-9]{16,128}$/
const AWS_SECRET_KEY_PATTERN = /^[A-Za-z0-9+/=]{40,128}$/

type StoreValidationErrorCode =
  | 'tavily_api_key_invalid_type'
  | 'tavily_api_key_invalid_format'
  | 'proxy_port_out_of_range'
  | 'proxy_missing_required_fields'
  | 'project_path_missing'
  | 'project_path_invalid_type'
  | 'project_path_empty'
  | 'project_path_root_forbidden'
  | 'api_auth_token_insufficient_strength'

const createStoreValidationError = (
  code: StoreValidationErrorCode,
  metadata: Record<string, unknown> = {}
) =>
  createStructuredError({
    name: 'StoreValidationError',
    message: 'Configuration sanitization failed',
    code,
    metadata
  })

type StoreStateOperation = 'get' | 'set' | 'open_in_editor'

const createStoreStateError = (operation: StoreStateOperation, key?: string) =>
  createStructuredError({
    name: 'StoreStateError',
    message: 'Configuration store is unavailable',
    code: 'store_uninitialized',
    metadata: key ? { operation, key } : { operation }
  })

type AwsCredentialErrorCode =
  | 'aws_credential_invalid_type'
  | 'aws_credential_invalid_format'

const createAwsCredentialError = (
  code: AwsCredentialErrorCode,
  metadata: Record<string, unknown>
) =>
  createStructuredError({
    name: 'AwsCredentialSanitizationError',
    message: 'AWS credential validation failed',
    code,
    metadata
  })

const sanitizeAwsCredential = (value: unknown, label: string, pattern: RegExp): string => {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value !== 'string') {
    throw createAwsCredentialError('aws_credential_invalid_type', {
      label,
      receivedType: typeof value
    })
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return ''
  }

  if (!pattern.test(trimmed)) {
    throw createAwsCredentialError('aws_credential_invalid_format', {
      label,
      allowedPattern: pattern.source
    })
  }

  return trimmed
}

const sanitizeAwsSessionToken = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw createAwsCredentialError('aws_credential_invalid_type', {
      label: 'AWS session token',
      receivedType: typeof value
    })
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  if (/[^A-Za-z0-9+/=]/.test(trimmed)) {
    throw createAwsCredentialError('aws_credential_invalid_format', {
      label: 'AWS session token',
      allowedPattern: '^[A-Za-z0-9+/=]+$'
    })
  }
  return trimmed
}

const sanitizeTavilyApiKey = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw createStoreValidationError('tavily_api_key_invalid_type', {
      receivedType: typeof value
    })
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  if (!TAVILY_API_KEY_PATTERN.test(trimmed)) {
    throw createStoreValidationError('tavily_api_key_invalid_format', {
      allowedPattern: TAVILY_API_KEY_PATTERN.source
    })
  }
  return trimmed
}

export const coerceAwsCredentials = (value: {
  accessKeyId?: unknown
  secretAccessKey?: unknown
  sessionToken?: unknown
}) => {
  return {
    accessKeyId: sanitizeAwsCredential(value.accessKeyId, 'AWS access key ID', AWS_ACCESS_KEY_PATTERN),
    secretAccessKey: sanitizeAwsCredential(
      value.secretAccessKey,
      'AWS secret access key',
      AWS_SECRET_KEY_PATTERN
    ),
    sessionToken: sanitizeAwsSessionToken(value.sessionToken)
  }
}

export const sanitizeProxyConfiguration = (value: unknown): ProxyConfiguration | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const input = value as Record<string, unknown>
  const enabled = input.enabled === true
  const protocol = input.protocol === 'https' ? 'https' : input.protocol === 'http' ? 'http' : undefined
  const host = typeof input.host === 'string' ? input.host.trim() : undefined

  let port: number | undefined
  if (typeof input.port === 'number' && Number.isInteger(input.port)) {
    if (input.port > 0 && input.port <= 65535) {
      port = input.port
    } else {
      throw createStoreValidationError('proxy_port_out_of_range', {
        constraint: '1-65535',
        receivedType: typeof input.port
      })
    }
  }

  const username = typeof input.username === 'string' ? input.username.trim() : undefined
  const password = typeof input.password === 'string' ? input.password.trim() : undefined

  if (!enabled) {
    return {
      enabled: false,
      host: host || undefined,
      port,
      username,
      password,
      protocol
    }
  }

  const missingFields: string[] = []
  if (!host) {
    missingFields.push('host')
  }
  if (!protocol) {
    missingFields.push('protocol')
  }
  if (typeof port !== 'number') {
    missingFields.push('port')
  }

  if (missingFields.length > 0) {
    throw createStoreValidationError('proxy_missing_required_fields', {
      missingFields
    })
  }

  return {
    enabled: true,
    host,
    port,
    username,
    password,
    protocol
  }
}

export const sanitizeAwsMetadata = (value: Partial<AWSCredentials>) => {
  const region = typeof value.region === 'string' && value.region.trim().length > 0 ? value.region.trim() : 'us-west-2'
  const useProfile = typeof value.useProfile === 'boolean' ? value.useProfile : undefined
  const profile =
    typeof value.profile === 'string' && value.profile.trim().length > 0 ? value.profile.trim() : undefined

  let proxyConfig: ProxyConfiguration | undefined
  try {
    proxyConfig = sanitizeProxyConfiguration(value.proxyConfig)
  } catch (error) {
    log.warn('Ignoring invalid proxy configuration in AWS settings', {
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return {
    region,
    useProfile,
    profile,
    proxyConfig
  }
}

export const sanitizeProjectPathValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    throw createStoreValidationError('project_path_missing', {
      reason: 'nullish'
    })
  }
  if (typeof value !== 'string') {
    throw createStoreValidationError('project_path_invalid_type', {
      receivedType: typeof value
    })
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw createStoreValidationError('project_path_empty', {
      reason: 'empty_string'
    })
  }

  const resolved = path.resolve(trimmed)
  if (isSystemRootDirectory(resolved)) {
    throw createStoreValidationError('project_path_root_forbidden', {
      reason: 'filesystem_root'
    })
  }

  return resolved
}

const resolveStoreOptions = (): ElectronStoreOptions<StoreScheme> => {
  const options: ElectronStoreOptions<StoreScheme> = {
    name: 'settings'
  }

  if (typeof process.type === 'undefined') {
    options.cwd = path.join(os.tmpdir(), 'bedrock-engineer')
  }

  return options
}

let cachedCredentials: {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
} = {
  accessKeyId: '',
  secretAccessKey: ''
}

const getDefaultStorageDir = (storePath?: string) => {
  if (storePath) {
    return path.dirname(storePath)
  }

  const homeDir = os.homedir() || process.cwd()
  return path.join(homeDir, '.bedrock-engineer')
}

export const ensureFallbackKey = async (directory: string) => {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    await fs.chmod(directory, 0o700)
  } catch (error) {
    log.warn('Unable to enforce restrictive permissions on fallback directory', {
      directory,
      error: error instanceof Error ? error.message : String(error)
    })
  }
  return path.join(directory, FALLBACK_ENCRYPTION_FILENAME)
}

export const readFallbackKey = async (filePath: string): Promise<string | null> => {
  try {
    const stats = await fs.lstat(filePath)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      await fs.rm(filePath, { force: true })
      log.warn('Ignoring fallback encryption key with unsafe file type', {
        filePath
      })
      return null
    }

    const permissions = stats.mode & 0o777
    if (permissions !== 0o600) {
      await fs.rm(filePath, { force: true })
      log.warn('Ignoring fallback encryption key with insecure permissions', {
        filePath,
        permissions: permissions.toString(8)
      })
      return null
    }

    const key = await fs.readFile(filePath, 'utf8')
    if (key.trim().length === 64) {
      return key.trim()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('Unable to read fallback encryption key', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return null
}

export const writeFallbackKey = async (filePath: string, key: string) => {
  await fs.rm(filePath, { force: true })
  const handle = await fs.open(filePath, fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_EXCL, 0o600)
  try {
    await handle.writeFile(key, { encoding: 'utf8' })
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.chmod(filePath, 0o600)
}

const persistAwsCredentials = async (
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string
) => {
  const {
    accessKeyId: normalizedAccessKeyId,
    secretAccessKey: normalizedSecretAccessKey,
    sessionToken: normalizedSessionToken
  } = coerceAwsCredentials({ accessKeyId, secretAccessKey, sessionToken })

  if (!electronStore) {
    log.warn('Attempted to persist AWS credentials before store initialization')
    return
  }
  if (keytarAvailable) {
    try {
      await Promise.all([
        normalizedAccessKeyId
          ? keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCESS_ID, normalizedAccessKeyId)
          : keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCESS_ID),
        normalizedSecretAccessKey
          ? keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_SECRET, normalizedSecretAccessKey)
          : keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_SECRET),
        normalizedSessionToken
          ? keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_SESSION, normalizedSessionToken)
          : keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_SESSION)
      ])
      return electronStore.delete(FALLBACK_AWS_CREDENTIALS_KEY)
    } catch (error) {
      keytarAvailable = false
      log.warn('Falling back to encrypted store for AWS credentials', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  electronStore.set(FALLBACK_AWS_CREDENTIALS_KEY, {
    accessKeyId: normalizedAccessKeyId,
    secretAccessKey: normalizedSecretAccessKey,
    sessionToken: normalizedSessionToken
  })
}

const DEFAULT_SHELL =
  process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe' // Windows環境ではcmd.exe
    : '/bin/bash' // Unix系環境では/bin/bash
const DEFAULT_INFERENCE_PARAMS: InferenceParameters = {
  maxTokens: 4096,
  temperature: 0.5,
  topP: 0.9
}
const DEFAULT_THINKING_MODE: ThinkingMode = {
  type: 'enabled',
  budget_tokens: ThinkingModeBudget.NORMAL
}

const DEFAULT_BEDROCK_SETTINGS = {
  enableRegionFailover: false,
  availableFailoverRegions: [],
  enableInferenceProfiles: false
}

const DEFAULT_GUARDRAIL_SETTINGS: NonNullable<StoreScheme['guardrailSettings']> = {
  enabled: false,
  guardrailIdentifier: '',
  guardrailVersion: 'DRAFT',
  trace: 'enabled'
}

type StoreScheme = {
  /** Electronアプリケーションのユーザーデータ保存先パス */
  userDataPath?: string

  /** 現在選択されているプロジェクト（作業ディレクトリ）のパス */
  projectPath?: string

  /** Plan/Act モードの設定 (true: Plan, false: Act) */
  planMode?: boolean

  /** 現在選択されている言語モデル (LLM) の設定 */
  llm?: LLM

  /** 軽微な処理（タイトル生成など）に使用するモデルの設定 */
  lightProcessingModel?: LLM | null

  /** 言語モデルの推論パラメータ（温度、最大トークン数など） */
  inferenceParams: InferenceParameters

  /** 思考モードの設定（Claude 3.7 Sonnet用） */
  thinkingMode?: ThinkingMode

  /** インターリーブ思考の設定（思考モードの拡張機能） */
  interleaveThinking?: boolean

  /** 画像認識ツールの設定 */
  recognizeImageTool?: {
    /** 使用するモデルID */
    modelId: string
  }

  /** 画像生成ツールの設定 */
  generateImageTool?: {
    /** 使用するモデルID */
    modelId: string
  }

  /** 動画生成ツールの設定 */
  generateVideoTool?: {
    /** S3出力先URI */
    s3Uri: string
  }

  /** コードインタープリタツールの設定 */
  codeInterpreterTool?: CodeInterpreterContainerConfig

  /** アプリケーションの表示言語設定（日本語または英語） */
  language: 'ja' | 'en'

  /** スケジューラで使用するタイムゾーン */
  timezone?: string

  /** エージェントチャットの設定（無視するファイル一覧、コンテキスト長など） */
  agentChatConfig: AgentChatConfig

  /** 使用可能なツールの状態と設定（有効/無効、設定情報） */
  tools: ToolState[]

  /** ウェブサイトジェネレーター機能の設定 */
  websiteGenerator?: {
    /** 使用する知識ベース一覧 */
    knowledgeBases?: KnowledgeBase[]
    /** 知識ベース機能を有効にするかどうか */
    enableKnowledgeBase?: boolean
    /** 検索機能を有効にするかどうか */
    enableSearch?: boolean
  }

  /** Tavily検索APIの設定 */
  tavilySearch: {
    /** Tavily検索APIのAPIキー */
    apikey: string
  }

  /** Backend の APIエンドポイントのURL */
  apiEndpoint: string

  /** Backend API とソケット通信で利用する共有認証トークン */
  apiAuthToken?: string

  /** 高度な設定オプション */
  advancedSetting: {
    /** キーボードショートカット設定 */
    keybinding: {
      /** メッセージ送信キーの設定（EnterまたはCmd+Enter） */
      sendMsgKey: SendMsgKey
    }
  }

  /** AWS認証情報とリージョン設定 */
  aws: AWSCredentials

  /** ユーザーが作成したカスタムエージェントの一覧 */
  customAgents: CustomAgent[]

  /** 現在選択されているエージェントのID */
  selectedAgentId: string

  /** 使用可能な知識ベース一覧 */
  knowledgeBases: KnowledgeBase[]

  /** コマンド実行の設定（シェル設定） */
  shell: string

  /** 追加のPATH設定 */
  commandSearchPaths?: string[]

  /** コマンド実行時の最大同時実行数 */
  commandMaxConcurrentProcesses?: number

  /** コマンドに送信可能なstdinの最大バイト数 */
  commandMaxStdinBytes?: number

  /** サブプロセスへ伝播させる環境変数の許可リスト */
  commandPassthroughEnvKeys?: string[]

  /** 通知機能の有効/無効設定 */
  notification?: boolean

  /** Amazon Bedrock特有の設定 */
  bedrockSettings?: {
    /** リージョンフェイルオーバー機能の有効/無効 */
    enableRegionFailover: boolean
    /** フェイルオーバー時に使用可能なリージョン一覧 */
    availableFailoverRegions: string[]
    /** アプリケーション推論プロファイル機能の有効/無効 */
    enableInferenceProfiles: boolean
  }

  /** ガードレール設定 */
  guardrailSettings?: {
    /** ガードレールを有効にするかどうか */
    enabled: boolean
    /** ガードレールID */
    guardrailIdentifier: string
    /** ガードレールバージョン */
    guardrailVersion: string
    /** ガードレールのトレース設定 */
    trace: 'enabled' | 'disabled'
  }

  /** 使用可能なAmazon Bedrockエージェントの一覧 */
  bedrockAgents?: BedrockAgent[]

  /** YAML形式から読み込まれた共有エージェントの一覧 */
  sharedAgents?: CustomAgent[]

  /** Nova Sonic音声チャットで使用する音声ID */
  selectedVoiceId?: string

  /** バックグラウンドエージェントのスケジュールタスク */
  backgroundAgentScheduledTasks?: any[]

  /** 組織設定の一覧 */
  organizations?: OrganizationConfig[]
}

type ElectronStoreInstance = Store<StoreScheme> & {
  path: string
  store: StoreScheme
  delete: (key: keyof StoreScheme | string) => void
  clear: () => void
  get: (key: any, defaultValue?: any) => any
  set: (key: any, value?: any) => void
  openInEditor: () => Promise<void>
}

const isJsonSyntaxError = (error: unknown): error is Error => {
  return (
    error instanceof SyntaxError ||
    (error instanceof Error && /Unexpected token/.test(error.message))
  )
}

const readLegacyStoreData = async (
  options: ElectronStoreOptions<StoreScheme>,
  storeFilePath: string | null
): Promise<StoreScheme | undefined> => {
  if (!storeFilePath) {
    return undefined
  }

  try {
    const legacyStore = new Store<StoreScheme>(options) as ElectronStoreInstance
    const legacyData = legacyStore.store
    await fs.rm(storeFilePath, { force: true })
    return legacyData
  } catch (error) {
    if (isJsonSyntaxError(error)) {
      await fs.rm(storeFilePath, { force: true })
      return undefined
    }

    throw error
  }
}

const persistEncryptionKey = async (fallbackPath: string, key: string) => {
  if (keytarAvailable) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ENCRYPTION_KEY, key)
      await fs.rm(fallbackPath, { force: true })
      return
    } catch (error) {
      keytarAvailable = false
      log.warn('Failed to persist encryption key with keytar, using fallback file', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  await writeFallbackKey(fallbackPath, key)
}

const createElectronStore = async (): Promise<ElectronStoreInstance> => {
  const storeOptions = resolveStoreOptions()
  const storeFilePath =
    storeOptions.cwd && storeOptions.name
      ? path.join(storeOptions.cwd, `${storeOptions.name}.json`)
      : null
  const storageDir = getDefaultStorageDir(storeFilePath ?? undefined)
  const fallbackKeyPath = await ensureFallbackKey(storageDir)

  let encryptionKey: string | null = null
  let keySource: 'keytar' | 'fallback' | 'generated' = 'generated'

  if (keytarAvailable) {
    try {
      const existingKey = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ENCRYPTION_KEY)
      if (existingKey) {
        encryptionKey = existingKey
        keySource = 'keytar'
      }
    } catch (error) {
      keytarAvailable = false
      log.warn('Failed to retrieve encryption key from keytar, falling back to file storage', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  if (!encryptionKey) {
    const fallbackKey = await readFallbackKey(fallbackKeyPath)
    if (fallbackKey) {
      encryptionKey = fallbackKey
      keySource = 'fallback'
    }
  }

  if (!encryptionKey) {
    encryptionKey = randomBytes(32).toString('hex')
    keySource = 'generated'
  }

  if (keySource === 'keytar') {
    await fs.rm(fallbackKeyPath, { force: true })
  } else {
    await persistEncryptionKey(fallbackKeyPath, encryptionKey)
  }

  let legacyData: StoreScheme | undefined
  if (keySource === 'generated') {
    legacyData = await readLegacyStoreData(storeOptions, storeFilePath)
  }

  const encryptedOptions: ElectronStoreOptions<StoreScheme> = {
    ...storeOptions,
    encryptionKey
  }

  let encryptedStore: ElectronStoreInstance
  try {
    encryptedStore = new Store<StoreScheme>(encryptedOptions) as ElectronStoreInstance
  } catch (error) {
    if (isJsonSyntaxError(error)) {
      if (storeFilePath) {
        await fs.rm(storeFilePath, { force: true })
      }
      encryptedStore = new Store<StoreScheme>(encryptedOptions) as ElectronStoreInstance
    } else {
      throw error
    }
  }

  if (legacyData) {
    encryptedStore.store = legacyData
  }

  return encryptedStore
}

let electronStore: ElectronStoreInstance | null = null

const init = async () => {
  const storeInstance = await createElectronStore()
  electronStore = storeInstance
  log.debug('Electron store path resolved', {
    storePath: storeInstance.path
  })
  // Initialize userDataPath if not present
  const userDataPath = storeInstance.get('userDataPath')
  if (!userDataPath) {
    // This will be set from main process
    storeInstance.set('userDataPath', '')
  }

  const pjPath = storeInstance.get('projectPath')
  if (!pjPath) {
    const defaultProjectPath = process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME']
    storeInstance.set('projectPath', defaultProjectPath)
  }

  const keybinding = storeInstance.get('advancedSetting')?.keybinding
  if (!keybinding) {
    storeInstance.set('advancedSetting', {
      keybinding: {
        sendMsgKey: 'Enter'
      }
    })
  }

  const language = storeInstance.get('language')
  if (language === undefined) {
    storeInstance.set('language', 'en')
  }

  const timezone = storeInstance.get('timezone')
  if (!timezone) {
    storeInstance.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
  }

  // Initialize AWS settings if not present
  const awsConfig = storeInstance.get('aws') as Partial<AWSCredentials> | undefined
  if (!awsConfig) {
    storeInstance.set('aws', sanitizeAwsMetadata({ region: 'us-west-2' }) as any)
  }

  let storedAccessKeyId: string | null = null
  let storedSecretAccessKey: string | null = null
  let storedSessionToken: string | undefined

  if (keytarAvailable) {
    try {
      const [id, secret, session] = await Promise.all([
        keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCESS_ID),
        keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_SECRET),
        keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_SESSION)
      ])
      storedAccessKeyId = id
      storedSecretAccessKey = secret
      storedSessionToken = session || undefined
    } catch (error) {
      keytarAvailable = false
      log.warn('Failed to load AWS credentials from keytar, falling back to encrypted store', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const fallbackAwsCredentials = storeInstance.get(FALLBACK_AWS_CREDENTIALS_KEY) as
    | typeof cachedCredentials
    | undefined

  // Migrate old credentials from electron-store if present
  if (awsConfig?.accessKeyId || awsConfig?.secretAccessKey || awsConfig?.sessionToken) {
    let normalized = { accessKeyId: '', secretAccessKey: '', sessionToken: undefined as string | undefined }
    try {
      normalized = coerceAwsCredentials({
        accessKeyId: awsConfig.accessKeyId || storedAccessKeyId || fallbackAwsCredentials?.accessKeyId,
        secretAccessKey:
          awsConfig.secretAccessKey || storedSecretAccessKey || fallbackAwsCredentials?.secretAccessKey,
        sessionToken: awsConfig.sessionToken || storedSessionToken || fallbackAwsCredentials?.sessionToken
      })
    } catch (error) {
      log.warn('Ignoring invalid stored AWS credentials and clearing them', {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    await persistAwsCredentials(
      normalized.accessKeyId,
      normalized.secretAccessKey,
      normalized.sessionToken
    )

    cachedCredentials = normalized
    storeInstance.set(
      'aws',
      sanitizeAwsMetadata({
        region: awsConfig.region || 'us-west-2',
        useProfile: awsConfig.useProfile,
        profile: awsConfig.profile,
        proxyConfig: awsConfig.proxyConfig
      }) as any
    )
  } else {
    let normalized = { accessKeyId: '', secretAccessKey: '', sessionToken: undefined as string | undefined }
    try {
      normalized = coerceAwsCredentials({
        accessKeyId: storedAccessKeyId || fallbackAwsCredentials?.accessKeyId,
        secretAccessKey: storedSecretAccessKey || fallbackAwsCredentials?.secretAccessKey,
        sessionToken: storedSessionToken || fallbackAwsCredentials?.sessionToken
      })
    } catch (error) {
      log.warn('Clearing cached AWS credentials due to invalid persisted values', {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    cachedCredentials = normalized

    if (!keytarAvailable && fallbackAwsCredentials) {
      let fallbackNormalized = { accessKeyId: '', secretAccessKey: '', sessionToken: undefined as string | undefined }
      try {
        fallbackNormalized = coerceAwsCredentials(fallbackAwsCredentials)
      } catch (error) {
        log.warn('Fallback AWS credentials are invalid; skipping migration', {
          error: error instanceof Error ? error.message : String(error)
        })
        fallbackNormalized = normalized
      }
      await persistAwsCredentials(
        fallbackNormalized.accessKeyId,
        fallbackNormalized.secretAccessKey,
        fallbackNormalized.sessionToken
      )
    }
  }

  // Initialize inference parameters if not present
  const inferenceParams = storeInstance.get('inferenceParams')
  if (!inferenceParams) {
    storeInstance.set('inferenceParams', DEFAULT_INFERENCE_PARAMS)
  }

  // thinkingMode の初期化
  const thinkingMode = storeInstance.get('thinkingMode')
  if (!thinkingMode) {
    storeInstance.set('thinkingMode', DEFAULT_THINKING_MODE)
  }

  // Initialize interleaveThinking if not present
  const interleaveThinking = storeInstance.get('interleaveThinking')
  if (interleaveThinking === undefined) {
    storeInstance.set('interleaveThinking', false)
  }

  // Initialize custom agents if not present
  const customAgents = storeInstance.get('customAgents')
  if (!customAgents) {
    storeInstance.set('customAgents', [])
  }

  // Initialize selected agent id if not present
  const selectedAgentId = storeInstance.get('selectedAgentId')
  if (!selectedAgentId) {
    storeInstance.set('selectedAgentId', 'softwareAgent')
  }

  // Initialize knowledge bases
  const knowledgeBases = storeInstance.get('knowledgeBases')
  if (!knowledgeBases) {
    storeInstance.set('knowledgeBases', [])
  }

  // Initialize command settings if not present
  const shell = storeInstance.get('shell')
  if (!shell) {
    storeInstance.set('shell', DEFAULT_SHELL)
  }
  const commandSearchPaths = storeInstance.get('commandSearchPaths')
  if (!commandSearchPaths) {
    storeInstance.set('commandSearchPaths', [])
  }

  const commandMaxConcurrentProcesses = storeInstance.get('commandMaxConcurrentProcesses')
  if (typeof commandMaxConcurrentProcesses !== 'number' || !Number.isFinite(commandMaxConcurrentProcesses)) {
    storeInstance.set('commandMaxConcurrentProcesses', 2)
  }

  const commandMaxStdinBytes = storeInstance.get('commandMaxStdinBytes')
  if (typeof commandMaxStdinBytes !== 'number' || !Number.isFinite(commandMaxStdinBytes)) {
    storeInstance.set('commandMaxStdinBytes', 64 * 1024)
  }

  const commandPassthroughEnvKeys = storeInstance.get('commandPassthroughEnvKeys')
  if (!Array.isArray(commandPassthroughEnvKeys)) {
    storeInstance.set('commandPassthroughEnvKeys', [])
  }

  // Initialize bedrockSettings
  const bedrockSettings = storeInstance.get('bedrockSettings')
  if (!bedrockSettings) {
    storeInstance.set('bedrockSettings', DEFAULT_BEDROCK_SETTINGS)
  }

  // Initialize guardrailSettings
  const guardrailSettings = storeInstance.get('guardrailSettings')
  if (!guardrailSettings) {
    storeInstance.set('guardrailSettings', DEFAULT_GUARDRAIL_SETTINGS)
  }

  // Initialize lightProcessingModel if not present
  const lightProcessingModel = storeInstance.get('lightProcessingModel')
  if (lightProcessingModel === undefined) {
    // デフォルトでは設定なし（null）で、この場合はメインモデルかフォールバックが使用される
    storeInstance.set('lightProcessingModel', null)
  }

  // Initialize planMode if not present
  const planMode = storeInstance.get('planMode')
  if (planMode === undefined) {
    storeInstance.set('planMode', false)
  }

  // Initialize codeInterpreterTool if not present
  const codeInterpreterTool = storeInstance.get('codeInterpreterTool')
  if (!codeInterpreterTool) {
    storeInstance.set('codeInterpreterTool', {
      memoryLimit: '256m',
      cpuLimit: 0.5,
      timeout: 30
    })
  } else if ('enabled' in codeInterpreterTool && typeof codeInterpreterTool.enabled === 'boolean') {
    // Migrate from old format
    storeInstance.set('codeInterpreterTool', {
      memoryLimit: '256m',
      cpuLimit: 0.5,
      timeout: 30
    })
  }

  // Initialize selectedVoiceId if not present
  const selectedVoiceId = storeInstance.get('selectedVoiceId')
  if (!selectedVoiceId) {
    storeInstance.set('selectedVoiceId', 'amy') // デフォルトはAmy
  }
}

export const storeReady = init()

type Key = keyof StoreScheme
export const store = {
  get<T extends Key>(key: T): StoreScheme[T] {
    if (!electronStore) {
      throw createStoreStateError('get', key as string)
    }
    if (key === 'aws') {
      const aws = electronStore.get('aws') as Partial<AWSCredentials> | undefined
      return {
        region: aws?.region || 'us-west-2',
        useProfile: aws?.useProfile,
        profile: aws?.profile,
        proxyConfig: aws?.proxyConfig,
        accessKeyId: cachedCredentials.accessKeyId,
        secretAccessKey: cachedCredentials.secretAccessKey,
        sessionToken: cachedCredentials.sessionToken
      } as StoreScheme[T]
    }
    return electronStore.get(key) as StoreScheme[T]
  },
  set<T extends Key>(key: T, value: StoreScheme[T]): void {
    if (!electronStore) {
      throw createStoreStateError('set', key as string)
    }
    if (key === 'aws') {
      const awsValue = value as AWSCredentials
      const { accessKeyId, secretAccessKey, sessionToken, ...rest } = awsValue
      const normalized = coerceAwsCredentials({ accessKeyId, secretAccessKey, sessionToken })
      void persistAwsCredentials(
        normalized.accessKeyId,
        normalized.secretAccessKey,
        normalized.sessionToken
      )
      cachedCredentials = normalized
      return electronStore.set('aws', sanitizeAwsMetadata(rest) as any)
    }
    if (key === 'projectPath') {
      if (value === null || value === undefined || value === '') {
        electronStore.delete('projectPath')
        return
      }
      const sanitized = sanitizeProjectPathValue(value)
      return electronStore.set('projectPath', sanitized as StoreScheme[typeof key])
    }
    if (key === 'apiEndpoint') {
      if (value === null || value === undefined || value === '') {
        electronStore.delete('apiEndpoint')
        return
      }
      const sanitized = normalizeNetworkEndpoint(value, { allowLoopbackHttp: true })
      return electronStore.set('apiEndpoint', sanitized as StoreScheme[typeof key])
    }
    if (key === 'tavilySearch') {
      if (value === null || value === undefined) {
        electronStore.delete('tavilySearch')
        return
      }
      const input = value as { apikey?: unknown }
      const apiKey = sanitizeTavilyApiKey(input.apikey)
      if (!apiKey) {
        electronStore.delete('tavilySearch')
        return
      }
      return electronStore.set('tavilySearch', { apikey: apiKey } as StoreScheme[typeof key])
    }
    if (key === 'apiAuthToken') {
      const normalized = normalizeApiToken(value)
      if (!normalized) {
        throw createStoreValidationError('api_auth_token_insufficient_strength', {
          minimumLength: MIN_API_TOKEN_LENGTH
        })
      }
      return electronStore.set('apiAuthToken', normalized)
    }
    return electronStore.set(key, value)
  },
  async openInEditor(): Promise<void> {
    if (!electronStore) {
      throw createStoreStateError('open_in_editor')
    }

    try {
      await electronStore.openInEditor()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error('Failed to open configuration store in editor', {
        error: errorMessage
      })
      throw createStructuredError({
        name: 'StoreInspectorError',
        message: 'Failed to open configuration store.',
        code: 'store_open_in_editor_failed',
        metadata: {
          reason: 'electron_store_open_failed',
          errorMessage
        }
      })
    }
  }
}

const setElectronStoreForTests = (instance: ElectronStoreInstance | null) => {
  electronStore = instance
}

export const __test__ = { sanitizeTavilyApiKey, setElectronStoreForTests }

export type ConfigStore = typeof store
