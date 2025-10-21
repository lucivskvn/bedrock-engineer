import { diag, DiagConsoleLogger, DiagLogLevel, trace } from '@opentelemetry/api'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

export interface TracingOptions {
  serviceName?: string
  otlpEndpoint?: string
  headers?: Record<string, string>
  enabled?: boolean
}

let provider: NodeTracerProvider | undefined

const resolveHeaders = (headers?: Record<string, string>): Record<string, string> | undefined => {
  if (headers && Object.keys(headers).length > 0) {
    return headers
  }

  const envHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS
  if (!envHeaders) {
    return undefined
  }

  return envHeaders
    .split(',')
    .map((pair) => pair.split('='))
    .filter(([key, value]) => key && value)
    .reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key.trim()] = value.trim()
      return acc
    }, {})
}

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

export const initializeTracing = (options: TracingOptions = {}): NodeTracerProvider | undefined => {
  if (provider) {
    return provider
  }

  if (options.enabled === false || process.env.OTEL_SDK_DISABLED === 'true') {
    return undefined
  }

  const serviceName =
    options.serviceName || process.env.OTEL_SERVICE_NAME || 'bedrock-engineer-service'

  const resource = resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName
  })

  const exporterEndpoint = options.otlpEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const configuredSpanProcessors: BatchSpanProcessor[] = []

  if (exporterEndpoint) {
    const exporter = new OTLPTraceExporter({
      url: exporterEndpoint,
      headers: resolveHeaders(options.headers)
    })
    configuredSpanProcessors.push(new BatchSpanProcessor(exporter))
  }

  const tracerProvider = new NodeTracerProvider({ resource, spanProcessors: configuredSpanProcessors })

  tracerProvider.register()
  provider = tracerProvider
  return tracerProvider
}

export const getTracer = () => {
  if (!provider) {
    return trace.getTracer('bedrock-engineer')
  }
  return provider.getTracer('bedrock-engineer')
}

export const shutdownTracing = async (): Promise<void> => {
  if (!provider) {
    return
  }

  await provider.shutdown()
  provider = undefined
}
