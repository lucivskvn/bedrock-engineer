import { createPdfError, summarizeUnknownError } from './errors'

export type PdfMetadataKey =
  | 'CreationDate'
  | 'xmp:CreateDate'
  | 'xap:CreateDate'
  | 'xmp:MetadataDate'

export type PdfInfoSummary = {
  total: number
  info?: {
    Title?: string
    Author?: string
    Creator?: string
    Producer?: string
  }
  getDateNode(): Record<'CreationDate' | 'XmpCreateDate' | 'XapCreateDate' | 'MetadataDate', string | undefined>
}

export type PdfTextSummary = {
  text: string
  total: number
}

type PdfParseModule = typeof import('pdf-parse')

export type PdfParseFunction = (
  data: Buffer,
  options?: Record<string, unknown>
) => Promise<{
  text?: string
  numpages?: number
  numrender?: number
  info?: PdfInfoSummary['info'] | null
  metadata?: {
    get?: (key: string) => unknown
    has?: (key: string) => boolean
    [key: string]: unknown
  } | null
}>

let cachedPdfParseFunction: PdfParseFunction | null = null
let cachedPdfParsePromise: Promise<PdfParseFunction> | null = null

const loadPdfParseFunction = async (): Promise<PdfParseFunction> => {
  let moduleExports: PdfParseModule | { default: PdfParseModule }
  try {
    // eslint-disable-next-line no-restricted-syntax -- pdf-parse ships a CJS entry point
    moduleExports = await import('pdf-parse')
  } catch (error) {
    throw createPdfError('PDF_PARSE_FAILED', {
      reason: 'module_load_failed',
      errorSummary: summarizeUnknownError(error)
    })
  }

  const candidate = (moduleExports as { default?: unknown }).default ?? moduleExports

  if (typeof candidate !== 'function') {
    throw createPdfError('PDF_PARSE_FAILED', {
      reason: 'invalid_export_type',
      exportType: typeof candidate
    })
  }

  return candidate as PdfParseFunction
}

const resolvePdfParseFunction = async (): Promise<PdfParseFunction> => {
  if (cachedPdfParseFunction) {
    return cachedPdfParseFunction
  }

  if (!cachedPdfParsePromise) {
    cachedPdfParsePromise = loadPdfParseFunction()
  }

  try {
    cachedPdfParseFunction = await cachedPdfParsePromise
    return cachedPdfParseFunction
  } catch (error) {
    cachedPdfParsePromise = null
    throw error
  }
}

const resolvePageTotal = (result: Awaited<ReturnType<PdfParseFunction>>): number => {
  if (typeof result.numpages === 'number' && Number.isFinite(result.numpages)) {
    return result.numpages
  }

  if (typeof result.numrender === 'number' && Number.isFinite(result.numrender)) {
    return result.numrender
  }

  return 0
}

const extractMetadataValue = (
  metadata: Awaited<ReturnType<PdfParseFunction>>['metadata'],
  key: PdfMetadataKey
): string | undefined => {
  if (!metadata) {
    return undefined
  }

  if (typeof metadata.get === 'function') {
    try {
      const value = metadata.get(key)
      return typeof value === 'string' && value.length > 0 ? value : undefined
    } catch {
      return undefined
    }
  }

  const direct = metadata[key]
  return typeof direct === 'string' && direct.length > 0 ? direct : undefined
}

export class PDFParse {
  private readonly data: Buffer

  private parsePromise: Promise<Awaited<ReturnType<PdfParseFunction>>> | null = null

  constructor({ data }: { data: Buffer }) {
    this.data = data
  }

  private async ensureParsed(): Promise<Awaited<ReturnType<PdfParseFunction>>> {
    if (!this.parsePromise) {
      this.parsePromise = resolvePdfParseFunction().then((fn) => fn(this.data))
    }

    try {
      return await this.parsePromise
    } catch (error) {
      this.parsePromise = null

      if (
        error instanceof Error &&
        (error as { code?: unknown }).code === 'PDF_PARSE_FAILED'
      ) {
        throw error
      }

      const metadata: Record<string, unknown> = {
        reason: 'parse_execution_failed',
        errorSummary: summarizeUnknownError(error)
      }

      if (error instanceof Error) {
        const errorCode = (error as { code?: unknown }).code
        if (typeof errorCode === 'string' && errorCode.length > 0) {
          metadata.errorCode = errorCode
        }
      }

      throw createPdfError('PDF_PARSE_FAILED', metadata)
    }
  }

  async getText(): Promise<PdfTextSummary> {
    const result = await this.ensureParsed()

    return {
      text: typeof result.text === 'string' ? result.text : '',
      total: resolvePageTotal(result)
    }
  }

  async getInfo(): Promise<PdfInfoSummary> {
    const result = await this.ensureParsed()
    const total = resolvePageTotal(result)

    const info =
      result.info && typeof result.info === 'object'
        ? { ...result.info }
        : undefined

    const dateNode = {
      CreationDate: extractMetadataValue(result.metadata, 'CreationDate'),
      XmpCreateDate: extractMetadataValue(result.metadata, 'xmp:CreateDate'),
      XapCreateDate: extractMetadataValue(result.metadata, 'xap:CreateDate'),
      MetadataDate: extractMetadataValue(result.metadata, 'xmp:MetadataDate')
    }

    return {
      total,
      info,
      getDateNode: () => dateNode
    }
  }

  async destroy(): Promise<void> {
    this.parsePromise = null
  }
}

export const resetPdfParseCacheForTests = () => {
  cachedPdfParseFunction = null
  cachedPdfParsePromise = null
}
