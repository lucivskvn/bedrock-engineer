import { contextBridge, ipcRenderer } from 'electron'

export const cameraPreview = {
  closeWindow: (deviceId: string) =>
    ipcRenderer.invoke('camera:close-preview-window', deviceId),
  hidePreview: () => ipcRenderer.invoke('camera:hide-preview-window')
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('cameraPreview', cameraPreview)
} else {
  // @ts-ignore
  window.cameraPreview = cameraPreview
}
