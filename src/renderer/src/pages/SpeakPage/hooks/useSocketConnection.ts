import { rendererLogger as log } from '@renderer/lib/logger';
import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SocketEvents {
  contentStart: (data: any) => void
  textOutput: (data: any) => void
  audioOutput: (data: any) => void
  contentEnd: (data: any) => void
  streamComplete: () => void
  error: (error: any) => void
  toolUse: (data: any) => void
  toolResult: (data: any) => void
}

export interface UseSocketConnectionReturn {
  socket: Socket | null
  status: ConnectionStatus
  sendAudioInput: (audioData: string) => void
  sendPromptStart: (tools?: any[], voiceId?: string) => void
  sendSystemPrompt: (prompt: string) => void
  sendAudioStart: () => void
  sendStopAudio: () => void
  connect: () => void
  disconnect: () => void
}

export function useSocketConnection(
  serverUrl?: string,
  events?: Partial<SocketEvents>
): UseSocketConnectionReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const socketRef = useRef<Socket | null>(null)
  const lastErrorTimeRef = useRef<number>(0)
  const ERROR_THROTTLE_MS = 5000 // 5秒間は同じエラーを出力しない

  // Connect to server
  const connect = useCallback(() => {
    if (socketRef.current?.connected) {
      return
    }

    if (!serverUrl) {
      log.error('Cannot connect: serverUrl is required')
      setStatus('error')
      events?.error?.(new Error('Server URL is required'))
      return
    }

    setStatus('connecting')

    try {
      const socket = io(serverUrl)
      socketRef.current = socket

      // Connection event handlers
      socket.on('connect', () => {
        log.debug('Connected to server:', socket.id)
        setStatus('connected')
      })

      socket.on('disconnect', (reason) => {
        log.debug('Disconnected from server:', reason)
        setStatus('disconnected')
      })

      socket.on('connect_error', (error) => {
        log.error('Connection error:', error)
        setStatus('error')
        events?.error?.(error)
      })

      // Application event handlers
      socket.on('contentStart', (data) => {
        log.debug('contentStart received:', data)
        events?.contentStart?.(data)
      })

      socket.on('textOutput', (data) => {
        log.debug('textOutput received:', data)
        events?.textOutput?.(data)
      })

      socket.on('audioOutput', (data) => {
        log.debug('audioOutput received')
        events?.audioOutput?.(data)
      })

      socket.on('toolUse', (data) => {
        log.debug('toolUse received:', data)
        events?.toolUse?.(data)
      })

      socket.on('toolResult', (data) => {
        log.debug('toolResult received:', data)
        events?.toolResult?.(data)
      })

      socket.on('contentEnd', (data) => {
        log.debug('contentEnd received:', data)
        events?.contentEnd?.(data)
      })

      socket.on('streamComplete', () => {
        log.debug('streamComplete received')
        events?.streamComplete?.()
      })

      socket.on('error', (error) => {
        log.error('Socket error:', error)
        setStatus('error')
        events?.error?.(error)
      })

      // Tool execution request handler
      socket.on('tool:executeRequest', async (toolRequest) => {
        const startTime = Date.now()
        const requestId = toolRequest.requestId || 'unknown'

        try {
          log.debug('Received tool execution request:', {
            requestId,
            toolRequest: toolRequest
          })

          // Validate request structure
          if (!toolRequest.type) {
            throw new Error('Tool type is required')
          }

          if (!toolRequest.requestId) {
            throw new Error('Request ID is required')
          }

          // Execute the tool using the preload API
          log.debug(`Executing tool ${toolRequest.type} via preload API...`)
          const result = await window.api.bedrock.executeTool(toolRequest)

          const duration = Date.now() - startTime
          log.debug('Tool execution completed successfully:', {
            requestId,
            toolType: toolRequest.type,
            duration: `${duration}ms`,
            resultType: typeof result,
            resultPreview:
              typeof result === 'string'
                ? result.substring(0, 100) + '...'
                : JSON.stringify(result).substring(0, 100) + '...'
          })

          // Send response back to server
          socket.emit('tool:executeResponse', {
            requestId: toolRequest.requestId,
            success: true,
            result: result
          })
        } catch (error) {
          const duration = Date.now() - startTime
          const errorMessage = error instanceof Error ? error.message : String(error)

          log.error('Tool execution failed:', {
            requestId,
            toolType: toolRequest.type,
            duration: `${duration}ms`,
            error: errorMessage,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            stack: error instanceof Error ? error.stack : undefined
          })

          // Determine error category for better debugging
          let errorCategory = 'unknown'
          if (errorMessage.includes('include_raw_content')) {
            errorCategory = 'validation'
          } else if (errorMessage.includes('timeout')) {
            errorCategory = 'timeout'
          } else if (errorMessage.includes('Network')) {
            errorCategory = 'network'
          } else if (errorMessage.includes('permission')) {
            errorCategory = 'permission'
          }

          // Send detailed error response back to server
          socket.emit('tool:executeResponse', {
            requestId: toolRequest.requestId,
            success: false,
            error: errorMessage,
            errorDetails: {
              category: errorCategory,
              duration: `${duration}ms`,
              toolType: toolRequest.type,
              timestamp: new Date().toISOString()
            }
          })
        }
      })
    } catch (error) {
      log.error('Failed to create socket connection:', error)
      setStatus('error')
      events?.error?.(error)
    }
  }, [serverUrl, events])

  // Disconnect from server
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
      setStatus('disconnected')
    }
  }, [])

  // Send audio input data
  const sendAudioInput = useCallback((audioData: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('audioInput', audioData)
    } else {
      const now = Date.now()
      if (now - lastErrorTimeRef.current > ERROR_THROTTLE_MS) {
        log.warn('Cannot send audio input: socket not connected')
        lastErrorTimeRef.current = now
      }
    }
  }, [])

  // Send prompt start
  const sendPromptStart = useCallback((tools?: any[], voiceId?: string) => {
    if (socketRef.current?.connected) {
      log.debug('Sending promptStart with tools:', tools?.length || 0, 'voiceId:', voiceId)
      socketRef.current.emit('promptStart', { tools, voiceId })
    } else {
      log.warn('Cannot send prompt start: socket not connected')
    }
  }, [])

  // Send system prompt
  const sendSystemPrompt = useCallback((prompt: string) => {
    if (socketRef.current?.connected) {
      log.debug('Sending systemPrompt:', prompt)
      socketRef.current.emit('systemPrompt', prompt)
    } else {
      log.warn('Cannot send system prompt: socket not connected')
    }
  }, [])

  // Send audio start
  const sendAudioStart = useCallback(() => {
    if (socketRef.current?.connected) {
      log.debug('Sending audioStart')
      socketRef.current.emit('audioStart')
    } else {
      log.warn('Cannot send audio start: socket not connected')
    }
  }, [])

  // Send stop audio
  const sendStopAudio = useCallback(() => {
    if (socketRef.current?.connected) {
      log.debug('Sending stopAudio')
      socketRef.current.emit('stopAudio')
    } else {
      log.warn('Cannot send stop audio: socket not connected')
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    socket: socketRef.current,
    status,
    sendAudioInput,
    sendPromptStart,
    sendSystemPrompt,
    sendAudioStart,
    sendStopAudio,
    connect,
    disconnect
  }
}
