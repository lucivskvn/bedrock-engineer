import type { ConfigStore } from '../preload/store'

declare global {
  interface Window {
    store: ConfigStore
  }
}

export {}
