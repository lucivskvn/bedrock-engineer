import type { RequestHandler } from 'express'
import type { CategoryLogger } from '../../../common/logger'
import { sendApiErrorResponse } from '../api-error-response'

export const API_PERMISSIONS = {
  MONITORING_READ: 'monitoring:read',
  BEDROCK_CONVERSE_STREAM: 'bedrock:converse-stream',
  BEDROCK_LIST_MODELS: 'bedrock:list-models',
  BEDROCK_DIAGNOSTICS: 'bedrock:diagnostics',
  SONIC_STREAM_SESSION: 'sonic:stream-session'
} as const

export type ApiPermission = (typeof API_PERMISSIONS)[keyof typeof API_PERMISSIONS]

export const API_ROLES = ['admin', 'operator', 'observer'] as const

export type DefaultApiRole = (typeof API_ROLES)[number]
export type ApiRole = DefaultApiRole | (string & {})

const DEFAULT_ROLE_PERMISSIONS: Record<DefaultApiRole, ReadonlyArray<ApiPermission>> = {
  admin: Object.values(API_PERMISSIONS),
  operator: [
    API_PERMISSIONS.MONITORING_READ,
    API_PERMISSIONS.BEDROCK_CONVERSE_STREAM,
    API_PERMISSIONS.BEDROCK_LIST_MODELS,
    API_PERMISSIONS.BEDROCK_DIAGNOSTICS,
    API_PERMISSIONS.SONIC_STREAM_SESSION
  ],
  observer: [API_PERMISSIONS.MONITORING_READ]
}

export interface PermissionResolutionResult {
  permissions: Set<ApiPermission>
  unknownPermissions: string[]
  roleIsUnknown: boolean
}

export interface PermissionResolutionOptions {
  role: ApiRole
  roleOverrides?: Record<string, ReadonlyArray<string>>
  explicitPermissions?: ReadonlyArray<string>
  logger?: Pick<CategoryLogger, 'warn'>
}

function isDefaultRole(role: string): role is DefaultApiRole {
  return (API_ROLES as ReadonlyArray<string>).includes(role)
}

function normalisePermission(value: string): ApiPermission | null {
  const trimmed = value.trim()
  const normalised = (Object.values(API_PERMISSIONS) as ReadonlyArray<string>).find(
    (permission) => permission === trimmed
  )

  return (normalised as ApiPermission | undefined) ?? null
}

export function resolvePermissionsForRole(options: PermissionResolutionOptions): PermissionResolutionResult {
  const { role, roleOverrides, explicitPermissions = [], logger } = options
  const resolved = new Set<ApiPermission>()
  const unknownPermissions: string[] = []
  let roleIsUnknown = false

  const collectPermissions = (candidates: ReadonlyArray<string>) => {
    for (const candidate of candidates) {
      const permission = normalisePermission(candidate)
      if (permission) {
        resolved.add(permission)
      } else {
        unknownPermissions.push(candidate)
        logger?.warn('Ignoring unknown permission for API role', {
          role,
          permission: candidate
        })
      }
    }
  }

  if (roleOverrides && role in roleOverrides) {
    const override = roleOverrides[role]
    if (override.includes('*')) {
      for (const permission of Object.values(API_PERMISSIONS)) {
        resolved.add(permission)
      }
    } else {
      collectPermissions(override)
    }
  } else if (isDefaultRole(role)) {
    for (const permission of DEFAULT_ROLE_PERMISSIONS[role]) {
      resolved.add(permission)
    }
  } else {
    roleIsUnknown = true
    logger?.warn('Applying observer permissions to unknown API role', { role })
    for (const permission of DEFAULT_ROLE_PERMISSIONS.observer) {
      resolved.add(permission)
    }
  }

  if (explicitPermissions.length > 0) {
    collectPermissions(explicitPermissions)
  }

  if (resolved.size === 0) {
    for (const permission of DEFAULT_ROLE_PERMISSIONS.observer) {
      resolved.add(permission)
    }
  }

  return { permissions: resolved, unknownPermissions, roleIsUnknown }
}

export interface AuthorisedIdentitySummary {
  role: ApiRole
  permissions: Set<ApiPermission>
  source?: string
  tokenFingerprint?: string
}

export interface PermissionMiddlewareOptions {
  permission: ApiPermission
  logger: Pick<CategoryLogger, 'warn'>
}

export function ensurePermission(identity: AuthorisedIdentitySummary | undefined, permission: ApiPermission): boolean {
  return !!identity && identity.permissions.has(permission)
}

export function createPermissionMiddleware({
  permission,
  logger
}: PermissionMiddlewareOptions): RequestHandler {
  return (req, res, next) => {
    const identity = req.authIdentity

    if (!identity) {
      logger.warn('Missing authentication identity on request before authorisation check', {
        path: req.path,
        method: req.method,
        permission
      })
      sendApiErrorResponse(res, 'internal_server_error')
      return
    }

    if (!ensurePermission(identity, permission)) {
      const referenceId = sendApiErrorResponse(res, 'forbidden_request', { status: 403 })
      logger.warn('Denied request due to insufficient permissions', {
        path: req.path,
        method: req.method,
        permission,
        role: identity.role,
        source: identity.source,
        tokenFingerprint: identity.tokenFingerprint,
        referenceId
      })
      return
    }

    next()
  }
}
