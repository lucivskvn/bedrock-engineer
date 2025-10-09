import { rendererLogger as log } from '@renderer/lib/logger';
import { useRef, useState, useCallback, useEffect } from 'react'
import { AudioPlayer, AudioPlayedListener } from '../lib/AudioPlayer'

export type PlayerStatus = 'idle' | 'initializing' | 'ready' | 'playing' | 'error'

export interface UseAudioPlayerReturn {
  status: PlayerStatus
  isReady: boolean
  isPlaying: boolean
  start: () => Promise<void>
  stop: () => void
  playAudio: (samples: Float32Array) => void
  bargeIn: () => void
  getSamples: () => number[] | null
  getVolume: () => number
  addEventListener: (event: string, callback: AudioPlayedListener) => void
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const [status, setStatus] = useState<PlayerStatus>('idle')
  const audioPlayerRef = useRef<AudioPlayer | null>(null)
  const statusRef = useRef<PlayerStatus>('idle')

  // Initialize audio player
  const start = useCallback(async (): Promise<void> => {
    // Check both status and statusRef to avoid race conditions
    if (
      (status === 'ready' || status === 'initializing') &&
      (statusRef.current === 'ready' || statusRef.current === 'initializing')
    ) {
      log.debug(
        'Audio player already initialized or initializing, status:',
        status,
        'statusRef:',
        statusRef.current
      )
      return
    }

    try {
      log.debug('Starting audio player initialization...')
      setStatus('initializing')
      statusRef.current = 'initializing'

      const audioPlayer = new AudioPlayer()
      audioPlayerRef.current = audioPlayer

      // Wait for complete initialization
      await audioPlayer.start()

      // Double-check that the player is actually initialized
      const player = audioPlayer as any
      if (!player.initialized) {
        throw new Error('AudioPlayer initialization failed: initialized flag is false')
      }

      // Ensure state is properly synchronized
      statusRef.current = 'ready'
      setStatus('ready')

      // Force a re-render to ensure React state is updated
      setTimeout(() => {
        if (statusRef.current === 'ready' && status !== 'ready') {
          log.debug('Forcing state update to ready')
          setStatus('ready')
        }
      }, 0)

      log.debug(
        'Audio player started successfully, status:',
        'ready',
        'initialized:',
        player.initialized
      )
    } catch (error) {
      log.error('Error starting audio player:', error)
      setStatus('error')
      statusRef.current = 'error'
      audioPlayerRef.current = null
      throw error
    }
  }, [status])

  // Stop audio player
  const stop = useCallback(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop()
      audioPlayerRef.current = null
    }
    setStatus('idle')
    statusRef.current = 'idle'
  }, [])

  // Play audio samples with enhanced error checking
  const playAudio = useCallback(
    (samples: Float32Array) => {
      // Enhanced state checking
      if (!audioPlayerRef.current) {
        log.warn('Cannot play audio: player not created', {
          status: status,
          statusRef: statusRef.current
        })
        return
      }

      // Check both statusRef and actual player initialization state
      // Use statusRef.current instead of status for more reliable state checking
      const player = audioPlayerRef.current as any
      const isPlayerReady =
        player.initialized && (statusRef.current === 'ready' || statusRef.current === 'playing')

      if (isPlayerReady) {
        try {
          audioPlayerRef.current.playAudio(samples)
          setStatus('playing')
          statusRef.current = 'playing'

          // Reset to ready after a short delay
          setTimeout(() => {
            if (statusRef.current === 'playing') {
              setStatus('ready')
              statusRef.current = 'ready'
            }
          }, 100)
        } catch (error) {
          log.error('Error during audio playback:', error)
        }
      } else {
        log.warn('Cannot play audio: player not ready', {
          hasPlayer: !!audioPlayerRef.current,
          status: status,
          statusRef: statusRef.current,
          playerInitialized: player?.initialized || false,
          audioContextState: player?.audioContext?.state || 'unknown'
        })

        // Attempt to fix state synchronization issue
        if (
          player?.initialized &&
          statusRef.current !== 'ready' &&
          statusRef.current !== 'playing'
        ) {
          log.debug('Detected state desync, attempting to fix...')
          setStatus('ready')
          statusRef.current = 'ready'
        }
      }
    },
    [status]
  )

  // Barge in (interrupt current playback)
  const bargeIn = useCallback(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.bargeIn()
    }
  }, [])

  // Get audio samples for visualization
  const getSamples = useCallback((): number[] | null => {
    if (audioPlayerRef.current) {
      return audioPlayerRef.current.getSamples()
    }
    return null
  }, [])

  // Get current volume level
  const getVolume = useCallback((): number => {
    if (audioPlayerRef.current) {
      return audioPlayerRef.current.getVolume()
    }
    return 0
  }, [])

  // Add event listener
  const addEventListener = useCallback((event: string, callback: AudioPlayedListener) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.addEventListener(event, callback)
    }
  }, [])

  // Base64 to Float32Array conversion (from sample code)
  const base64ToFloat32Array = useCallback((base64String: string): Float32Array => {
    try {
      const binaryString = window.atob(base64String)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const int16Array = new Int16Array(bytes.buffer)
      const float32Array = new Float32Array(int16Array.length)
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0
      }

      return float32Array
    } catch (error) {
      log.error('Error in base64ToFloat32Array:', error)
      throw error
    }
  }, [])

  // Play audio from base64 data (convenience method)
  const playAudioFromBase64 = useCallback(
    (base64Data: string) => {
      try {
        const audioData = base64ToFloat32Array(base64Data)
        playAudio(audioData)
      } catch (error) {
        log.error('Error playing audio from base64:', error)
      }
    },
    [base64ToFloat32Array, playAudio]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return {
    status,
    isReady: status === 'ready',
    isPlaying: status === 'playing',
    start,
    stop,
    playAudio,
    bargeIn,
    getSamples,
    getVolume,
    addEventListener,
    // Export the base64 conversion as well for convenience
    playAudioFromBase64
  } as UseAudioPlayerReturn & { playAudioFromBase64: (base64Data: string) => void }
}
