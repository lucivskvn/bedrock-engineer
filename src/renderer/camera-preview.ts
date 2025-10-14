const log = window.logger.createCategoryLogger('camera-preview')

class CameraPreview {
  videoElement: HTMLVideoElement
  loadingMessage: HTMLElement
  errorMessage: HTMLElement
  errorDetails: HTMLElement
  statusIndicator: HTMLElement
  cameraInfo: HTMLElement
  cameraName: HTMLElement
  cameraResolution: HTMLElement
  currentStream: MediaStream | null
  isInitialized: boolean

  constructor() {
    this.videoElement = document.getElementById('videoStream') as HTMLVideoElement
    this.loadingMessage = document.getElementById('loadingMessage') as HTMLElement
    this.errorMessage = document.getElementById('errorMessage') as HTMLElement
    this.errorDetails = document.getElementById('errorDetails') as HTMLElement
    this.statusIndicator = document.getElementById('statusIndicator') as HTMLElement
    this.cameraInfo = document.getElementById('cameraInfo') as HTMLElement
    this.cameraName = document.getElementById('cameraName') as HTMLElement
    this.cameraResolution = document.getElementById('cameraResolution') as HTMLElement

    this.currentStream = null
    this.isInitialized = false

    this.init()
  }

  async init() {
    try {
      this.setupEventListeners()
      await this.startCameraStream()
      this.isInitialized = true
    } catch (error: any) {
      log.error('Failed to initialize camera preview', { error })
      this.showError('Initialization failed', error.message)
    }
  }

  setupEventListeners() {
    document.getElementById('closeBtn')?.addEventListener('click', async () => {
      this.cleanup()

      const urlParams = new URLSearchParams(window.location.search)
      const deviceId = urlParams.get('deviceId') || 'default'

      try {
        log.debug('Attempting to close individual preview window:', deviceId)
        const result = await window.api.camera.closePreviewWindow(deviceId)

        if (result.success) {
          log.debug('Individual window close result:', result.message)
        } else {
          log.error('Failed to close individual window', { message: result.message })
          await this.fallbackClose()
        }
      } catch (error: any) {
        log.error('Error during individual window close', { error })
        await this.fallbackClose()
      }
    })

    document.getElementById('settingsBtn')?.addEventListener('click', () => {
      log.debug('Settings clicked')
    })

    window.addEventListener('beforeunload', () => {
      this.cleanup()
    })

    this.videoElement.addEventListener('loadedmetadata', () => {
      this.onStreamLoaded()
    })

    this.videoElement.addEventListener('error', (error) => {
      log.error('Video element error', { error })
      this.showError('Video playback failed', 'Unable to display camera stream')
    })
  }

  async startCameraStream() {
    try {
      this.showLoading()

      const urlParams = new URLSearchParams(window.location.search)
      const targetDeviceId = urlParams.get('deviceId')
      const targetDeviceName = urlParams.get('deviceName')

      log.info('Starting camera stream for:', {
        deviceId: targetDeviceId,
        deviceName: targetDeviceName
      })

      if (targetDeviceName) {
        this.cameraName.textContent = decodeURIComponent(targetDeviceName)
        document.title = `Camera Preview - ${decodeURIComponent(targetDeviceName)}`
      }

      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: false
      }

      if (targetDeviceId && targetDeviceId !== 'default') {
        ;(constraints.video as MediaTrackConstraints).deviceId = { exact: targetDeviceId }
        log.info('Using specific camera device:', targetDeviceId)
      } else {
        log.info('Using default camera device')
      }

      this.currentStream = await navigator.mediaDevices.getUserMedia(constraints)
      this.videoElement.srcObject = this.currentStream

      await this.updateCameraInfo()
    } catch (error: any) {
      log.error('Camera access failed', { error })

      if (error.name === 'OverconstrainedError' || error.name === 'NotFoundError') {
        log.info('Falling back to default camera...')
        try {
          const fallbackConstraints: MediaStreamConstraints = {
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 }
            },
            audio: false
          }

          this.currentStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints)
          this.videoElement.srcObject = this.currentStream
          await this.updateCameraInfo()

          this.showWarning(
            'Using default camera',
            'Specified camera not available, using default camera instead'
          )
        } catch (fallbackError: any) {
          log.error('Fallback camera access also failed', { error: fallbackError })
          this.showError('Camera access failed', this.getErrorMessage(fallbackError))
        }
      } else {
        this.showError('Camera access failed', this.getErrorMessage(error))
      }
    }
  }

  async updateCameraInfo() {
    try {
      if (!this.currentStream) return

      const videoTrack = this.currentStream.getVideoTracks()[0]
      if (!videoTrack) return

      const settings = videoTrack.getSettings()
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((device) => device.kind === 'videoinput')

      const currentDevice = videoDevices.find((device) => device.deviceId === settings.deviceId)

      if (currentDevice) {
        this.cameraName.textContent = currentDevice.label || 'Camera'
      }

      if (settings.width && settings.height) {
        this.cameraResolution.textContent = `${settings.width}×${settings.height}`
      }
    } catch (error: any) {
      log.error('Failed to update camera info', { error })
    }
  }

  onStreamLoaded() {
    this.hideLoading()
    this.hideError()
    this.updateStatus('active')
  }

  showLoading() {
    this.loadingMessage.classList.remove('hidden')
    this.errorMessage.classList.add('hidden')
    this.updateStatus('loading')
  }

  hideLoading() {
    this.loadingMessage.classList.add('hidden')
  }

  showError(title: string, details: string) {
    this.loadingMessage.classList.add('hidden')
    this.errorMessage.classList.remove('hidden')
    this.errorMessage.firstElementChild!.textContent = title
    this.errorDetails.textContent = details
    this.updateStatus('error')
  }

  showWarning(title: string, details: string) {
    log.warn('Camera preview warning', {
      title,
      details
    })
    const warningElement = this.errorMessage.cloneNode(true) as HTMLElement
    warningElement.classList.add('warning-message')
    warningElement.classList.remove('hidden')
    warningElement.firstElementChild!.textContent = title
    ;(warningElement.children[1] as HTMLElement).textContent = details

    this.loadingMessage.classList.add('hidden')
    this.errorMessage.classList.add('hidden')

    document.getElementById('previewContainer')?.appendChild(warningElement)

    setTimeout(() => {
      if (warningElement.parentNode) {
        warningElement.parentNode.removeChild(warningElement)
      }
      this.updateStatus('active')
    }, 3000)

    this.updateStatus('warning')
  }

  hideError() {
    this.errorMessage.classList.add('hidden')
  }

  updateStatus(status: string) {
    const classes = ['status-active', 'status-loading', 'status-error', 'status-default']
    this.statusIndicator.classList.remove(...classes)
    switch (status) {
      case 'active':
        this.statusIndicator.classList.add('status-active')
        break
      case 'loading':
        this.statusIndicator.classList.add('status-loading')
        break
      case 'error':
        this.statusIndicator.classList.add('status-error')
        break
      default:
        this.statusIndicator.classList.add('status-default')
    }
  }

  getErrorMessage(error: any) {
    if (error.name === 'NotAllowedError') {
      return 'Camera permission denied. Please allow camera access in your browser settings.'
    } else if (error.name === 'NotFoundError') {
      return 'No camera device found. Please connect a camera and try again.'
    } else if (error.name === 'NotReadableError') {
      return 'Camera is already in use by another application.'
    } else if (error.name === 'OverconstrainedError') {
      return 'Camera does not support the requested configuration.'
    } else {
      return error.message || 'Unknown camera error occurred.'
    }
  }

  async fallbackClose() {
    try {
      log.debug('Attempting fallback close using hidePreviewWindow')
      const result = await window.api.camera.hidePreviewWindow()

      if (result.success) {
        log.debug('Fallback close successful:', result.message)
      } else {
        log.error('Fallback close failed', { message: result.message })
        window.close()
      }
    } catch (error: any) {
      log.error('Fallback close error', { error })
      window.close()
    }
  }

  cleanup() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => {
        track.stop()
      })
      this.currentStream = null
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new CameraPreview()
})

export {}
