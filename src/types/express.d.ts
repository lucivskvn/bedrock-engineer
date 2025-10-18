import 'express-serve-static-core'
import type { ApiAuthIdentity } from '../main/api/auth/api-token'

declare module 'express-serve-static-core' {
  interface Request {
    authIdentity?: ApiAuthIdentity
  }
}
