import { rendererLogger as log } from '@renderer/lib/logger';
import React from 'react'
import { SpeakChatStatus } from '../hooks/useSpeakChat'

export interface AudioControlsProps {
  status: SpeakChatStatus
  isConnected: boolean
  isRecording: boolean
  onStartRecording: () => Promise<void>
  onStopRecording: () => void
  disabled?: boolean
  className?: string
}

export const AudioControls: React.FC<AudioControlsProps> = ({
  status,
  isConnected,
  isRecording,
  onStartRecording,
  onStopRecording,
  disabled = false,
  className = ''
}) => {
  const handleStartRecording = async () => {
    try {
      await onStartRecording()
    } catch (error) {
      log.error('Failed to start recording:', error)
    }
  }

  const canStartRecording =
    isConnected && (status === 'ready' || status === 'connected') && !isRecording
  const canStopRecording = isRecording

  return (
    <div className={`flex flex-col items-center justify-center space-y-4 ${className}`}>
      {/* Recording Controls */}
      <div className="flex items-center space-x-4">
        {/* Start Recording Button */}
        <button
          onClick={handleStartRecording}
          disabled={disabled || !canStartRecording}
          className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-medium transition-all transform hover:scale-105 ${
            canStartRecording
              ? 'bg-green-500 hover:bg-green-600 shadow-md hover:shadow-lg'
              : 'bg-gray-400 cursor-not-allowed'
          }`}
          title={status === 'processing' ? 'Processing...' : 'Start Speaking'}
        >
          {status === 'processing' ? (
            <svg
              className="w-5 h-5 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          )}
        </button>

        {/* Stop Recording Button */}
        <button
          onClick={onStopRecording}
          disabled={disabled || !canStopRecording}
          className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-medium transition-all transform hover:scale-105 ${
            canStopRecording
              ? 'bg-red-500 hover:bg-red-600 shadow-md hover:shadow-lg'
              : 'bg-gray-400 cursor-not-allowed'
          }`}
          title="Stop Speaking"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      </div>

      {/* Status Indicators */}
      <div className="flex items-center justify-center min-h-[24px]">
        {/* Recording Indicator */}
        {isRecording && (
          <div className="flex items-center space-x-2 text-red-500">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium">Recording</span>
          </div>
        )}

        {/* Processing Indicator */}
        {status === 'processing' && (
          <div className="flex items-center space-x-2 text-yellow-500">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce"></div>
              <div
                className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce"
                style={{ animationDelay: '0.1s' }}
              ></div>
              <div
                className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce"
                style={{ animationDelay: '0.2s' }}
              ></div>
            </div>
            <span className="text-sm font-medium">Processing</span>
          </div>
        )}
      </div>
    </div>
  )
}
