import { rendererLogger as log } from '@renderer/lib/logger';
import { useRef, useState, useCallback } from 'react'

export type RecordingStatus = 'idle' | 'recording' | 'processing' | 'error'

export interface UseAudioRecorderReturn {
  status: RecordingStatus
  isRecording: boolean
  startRecording: () => Promise<void>
  stopRecording: () => void
  onAudioData?: (audioData: string) => void
}

export interface UseAudioRecorderOptions {
  onAudioData?: (audioData: string) => void
  targetSampleRate?: number
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}): UseAudioRecorderReturn {
  const { onAudioData, targetSampleRate = 16000 } = options
  const [status, setStatus] = useState<RecordingStatus>('idle')
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const samplingRatioRef = useRef<number>(1)
  const isRecordingRef = useRef<boolean>(false)

  // Check if Firefox
  const isFirefox = navigator.userAgent.toLowerCase().includes('firefox')

  // Convert ArrayBuffer to base64 string
  const arrayBufferToBase64 = useCallback((buffer: ArrayBuffer): string => {
    const binary: string[] = []
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.byteLength; i++) {
      binary.push(String.fromCharCode(bytes[i]))
    }
    return btoa(binary.join(''))
  }, [])

  // Check microphone permission status
  const checkMicrophonePermission = useCallback(async (): Promise<PermissionState> => {
    try {
      const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      return permission.state
    } catch (error) {
      log.warn('Could not check microphone permission', { error })
      return 'prompt' // Default to prompt if checking fails
    }
  }, [])

  // Start recording
  const startRecording = useCallback(async (): Promise<void> => {
    if (status === 'recording') {
      return
    }

    try {
      setStatus('processing')

      // Check microphone permission first
      const permissionState = await checkMicrophonePermission()
      log.debug('Microphone permission state:', permissionState)

      if (permissionState === 'denied') {
        throw new Error(
          'Microphone access is denied. Please allow microphone access in your browser settings.'
        )
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true
        // audio: {
        //   echoCancellation: true,
        //   noiseSuppression: true,
        //   autoGainControl: true
        // }
      })
      audioStreamRef.current = stream

      // Create audio context
      let audioContext: AudioContext
      if (isFirefox) {
        // Firefox doesn't allow audio context to have different sample rate than what the user media device offers
        audioContext = new AudioContext()
      } else {
        audioContext = new AudioContext({
          sampleRate: targetSampleRate
        })
      }

      audioContextRef.current = audioContext

      // Calculate sampling ratio (only relevant for Firefox)
      samplingRatioRef.current = audioContext.sampleRate / targetSampleRate
      log.debug(
        `AudioContext sampleRate: ${audioContext.sampleRate}, samplingRatio: ${samplingRatioRef.current}`
      )

      // Create audio processing nodes
      const sourceNode = audioContext.createMediaStreamSource(stream)
      sourceNodeRef.current = sourceNode

      if (audioContext.createScriptProcessor) {
        const processor = audioContext.createScriptProcessor(512, 1, 1)
        processorRef.current = processor

        processor.onaudioprocess = (e) => {
          if (!isRecordingRef.current) return

          const inputData = e.inputBuffer.getChannelData(0)
          const samplingRatio = samplingRatioRef.current
          const numSamples = Math.round(inputData.length / samplingRatio)
          const pcmData = isFirefox ? new Int16Array(numSamples) : new Int16Array(inputData.length)

          // Convert to 16-bit PCM
          if (isFirefox) {
            for (let i = 0; i < numSamples; i++) {
              // NOTE: for Firefox the samplingRatio is not 1,
              // so it will downsample by skipping some input samples
              // A better approach is to compute the mean of the samplingRatio samples
              // or pass through a low-pass filter first
              // But skipping is a preferable low-latency operation
              const index = Math.floor(i * samplingRatio)
              if (index < inputData.length) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[index])) * 0x7fff
              }
            }
          } else {
            for (let i = 0; i < inputData.length; i++) {
              pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff
            }
          }

          // Convert to base64
          const base64Data = arrayBufferToBase64(pcmData.buffer)

          // Send to callback
          if (onAudioData) {
            onAudioData(base64Data)
          }
        }

        sourceNode.connect(processor)
        processor.connect(audioContext.destination)
      }

      setStatus('recording')
      isRecordingRef.current = true
    } catch (error) {
      log.error('Error starting recording', { error })
      setStatus('error')
      throw error
    }
  }, [status, targetSampleRate, isFirefox, arrayBufferToBase64, onAudioData])

  // Stop recording
  const stopRecording = useCallback(() => {
    if (status !== 'recording') {
      return
    }

    setStatus('processing')
    isRecordingRef.current = false

    try {
      // Stop audio processing
      if (processorRef.current) {
        processorRef.current.disconnect()
        processorRef.current = null
      }

      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect()
        sourceNodeRef.current = null
      }

      // Close audio context
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }

      // Stop media stream
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop())
        audioStreamRef.current = null
      }

      setStatus('idle')
    } catch (error) {
      log.error('Error stopping recording', { error })
      setStatus('error')
    }
  }, [status])

  return {
    status,
    isRecording: status === 'recording',
    startRecording,
    stopRecording,
    onAudioData
  }
}
