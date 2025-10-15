declare module 'compression' {
  import type { RequestHandler } from 'express'
  import type { IncomingMessage, ServerResponse } from 'http'

  interface CompressionOptions {
    filter?(req: IncomingMessage, res: ServerResponse): boolean
    threshold?: number | string
  }

  const compression: (options?: CompressionOptions) => RequestHandler
  export default compression
}

declare module 'helmet' {
  import type { RequestHandler } from 'express'

  type MaybeBoolean = boolean | undefined

  interface HelmetReferrerPolicyOptions {
    policy?: string | string[]
  }

  interface HelmetCrossOriginResourcePolicyOptions {
    policy?: 'same-origin' | 'same-site' | 'cross-origin'
  }

  interface HelmetOptions {
    contentSecurityPolicy?: MaybeBoolean
    crossOriginEmbedderPolicy?: MaybeBoolean
    crossOriginResourcePolicy?: HelmetCrossOriginResourcePolicyOptions | MaybeBoolean
    referrerPolicy?: HelmetReferrerPolicyOptions | MaybeBoolean
    originAgentCluster?: MaybeBoolean
  }

  const helmet: (options?: HelmetOptions) => RequestHandler
  export default helmet
}

declare module 'get-port' {
  interface GetPortOptions {
    port?: number | Iterable<number>
    host?: string
  }

  export default function getPort(options?: GetPortOptions): Promise<number>
  export function portNumbers(from: number, to: number): Iterable<number>
}

declare module 'keytar' {
  export function getPassword(service: string, account: string): Promise<string | null>
  export function setPassword(service: string, account: string, password: string): Promise<void>
  export function deletePassword(service: string, account: string): Promise<boolean>
}

declare module '@testing-library/react' {
  export const render: (...args: unknown[]) => { rerender: (...args: unknown[]) => void; unmount: () => void }
  export const screen: {
    getByRole: (...args: unknown[]) => any
    findByRole: (...args: unknown[]) => Promise<any>
    [key: string]: unknown
  }
  export const fireEvent: {
    click: (...args: unknown[]) => boolean
    mouseDown: (...args: unknown[]) => boolean
    keyDown: (...args: unknown[]) => boolean
    [key: string]: (...args: unknown[]) => boolean
  }
  export const act: (...args: unknown[]) => Promise<void> | void
}
