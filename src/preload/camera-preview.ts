import { contextBridge, ipcRenderer } from 'electron'

const cameraPreview = {
  closePreviewWindow: (deviceId: string) =>
    ipcRenderer.invoke('camera:close-preview-window', deviceId),
  hidePreviewWindow: () => ipcRenderer.invoke('camera:hide-preview-window')
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('cameraPreview', cameraPreview)
} else {
  // @ts-ignore Expose API when context isolation is disabled
  ;(window as any).cameraPreview = cameraPreview
}
