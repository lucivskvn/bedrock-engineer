declare module 'electron-store' {
  export default class Store<T extends Record<string, any> = Record<string, unknown>> {
    constructor(options?: any)
    static initRenderer(): void
    get<K extends keyof T>(key: K): T[K]
    set<K extends keyof T>(key: K, value: T[K]): void
    delete(key: keyof T): void
    path: string
    store: T
  }
}

