// AudioWorklet types - simplified for worklet context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const AudioWorkletProcessor: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const registerProcessor: any

// Audio sample buffer to minimize reallocations
class ExpandableBuffer {
  private buffer: Float32Array
  private readIndex: number
  private writeIndex: number
  private underflowedSamples: number
  private isInitialBuffering: boolean
  public initialBufferLength: number
  private lastWriteTime: number

  constructor() {
    // Start with one second's worth of buffered audio capacity before needing to expand
    this.buffer = new Float32Array(24000)
    this.readIndex = 0
    this.writeIndex = 0
    this.underflowedSamples = 0
    this.isInitialBuffering = true
    this.initialBufferLength = 24000 // One second
    this.lastWriteTime = 0
  }

  logTimeElapsedSinceLastWrite(): void {
    const now = Date.now()
    if (this.lastWriteTime !== 0) {
      const elapsed = now - this.lastWriteTime
      console.debug(`Elapsed time since last audio buffer write: ${elapsed} ms`)
    }
    this.lastWriteTime = now
  }

  write(samples: Float32Array): void {
    this.logTimeElapsedSinceLastWrite()
    if (this.writeIndex + samples.length <= this.buffer.length) {
      // Enough space to append the new samples
    } else {
      // Not enough space ...
      if (samples.length <= this.readIndex) {
        // ... but we can shift samples to the beginning of the buffer
        const subarray = this.buffer.subarray(this.readIndex, this.writeIndex)
        console.debug(`Shifting the audio buffer of length ${subarray.length} by ${this.readIndex}`)
        this.buffer.set(subarray)
      } else {
        // ... and we need to grow the buffer capacity to make room for more audio
        const newLength = (samples.length + this.writeIndex - this.readIndex) * 2
        const newBuffer = new Float32Array(newLength)
        console.debug(`Expanding the audio buffer from ${this.buffer.length} to ${newLength}`)
        newBuffer.set(this.buffer.subarray(this.readIndex, this.writeIndex))
        this.buffer = newBuffer
      }
      this.writeIndex -= this.readIndex
      this.readIndex = 0
    }
    this.buffer.set(samples, this.writeIndex)
    this.writeIndex += samples.length
    if (this.writeIndex - this.readIndex >= this.initialBufferLength) {
      // Filled the initial buffer length, so we can start playback with some cushion
      this.isInitialBuffering = false
      console.debug('Initial audio buffer filled')
    }
  }

  read(destination: Float32Array): void {
    let copyLength = 0
    if (!this.isInitialBuffering) {
      // Only start to play audio after we've built up some initial cushion
      copyLength = Math.min(destination.length, this.writeIndex - this.readIndex)
    }
    destination.set(this.buffer.subarray(this.readIndex, this.readIndex + copyLength))
    this.readIndex += copyLength
    if (copyLength > 0 && this.underflowedSamples > 0) {
      console.debug(`Detected audio buffer underflow of ${this.underflowedSamples} samples`)
      this.underflowedSamples = 0
    }
    if (copyLength < destination.length) {
      // Not enough samples (buffer underflow). Fill the rest with silence.
      destination.fill(0, copyLength)
      this.underflowedSamples += destination.length - copyLength
    }
    if (copyLength === 0) {
      // Ran out of audio, so refill the buffer to the initial length before playing more
      this.isInitialBuffering = true
    }
  }

  clearBuffer(): void {
    this.readIndex = 0
    this.writeIndex = 0
  }
}

interface AudioWorkletMessage {
  type: 'audio' | 'initial-buffer-length' | 'barge-in'
  audioData?: Float32Array
  bufferLength?: number
}

class AudioPlayerProcessor extends AudioWorkletProcessor {
  private playbackBuffer: ExpandableBuffer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public port: any

  constructor() {
    super()
    this.playbackBuffer = new ExpandableBuffer()
    this.port.onmessage = (event: MessageEvent<AudioWorkletMessage>) => {
      if (event.data.type === 'audio' && event.data.audioData) {
        this.playbackBuffer.write(event.data.audioData)
      } else if (event.data.type === 'initial-buffer-length' && event.data.bufferLength) {
        // Override the current playback initial buffer length
        const newLength = event.data.bufferLength
        this.playbackBuffer.initialBufferLength = newLength
        console.debug(`Changed initial audio buffer length to: ${newLength}`)
      } else if (event.data.type === 'barge-in') {
        this.playbackBuffer.clearBuffer()
      }
    }
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const output = outputs[0]?.[0] // Assume one output with one channel
    if (output) {
      this.playbackBuffer.read(output)
    }
    return true // True to continue processing
  }
}

registerProcessor('audio-player-processor', AudioPlayerProcessor)
