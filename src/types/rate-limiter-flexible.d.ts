declare module 'rate-limiter-flexible' {
  export interface RateLimiterOptions {
    points: number
    duration: number
    blockDuration?: number
    keyPrefix?: string
    execEvenly?: boolean
    insuranceLimiter?: RateLimiterMemory
  }

  export interface ConsumeResponse {
    remainingPoints: number
    msBeforeNext: number
    consumedPoints: number
    isFirstInDuration?: boolean
  }

  export class RateLimiterMemory {
    constructor(options: RateLimiterOptions)
    consume(key: string | number, points?: number): Promise<ConsumeResponse>
    penalty(key: string | number, points?: number): Promise<ConsumeResponse>
    reward(key: string | number, points?: number): Promise<void>
    delete(key: string | number): Promise<boolean>
    get(key: string | number): Promise<ConsumeResponse | null>
  }
}
