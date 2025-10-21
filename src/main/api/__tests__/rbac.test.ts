import { afterEach, describe, expect, jest, test } from '@jest/globals'
import type { Request, Response } from 'express'
import {
  API_PERMISSIONS,
  API_ROLES,
  createPermissionMiddleware,
  ensurePermission,
  resolvePermissionsForRole
} from '../auth/rbac'
import { sendApiErrorResponse } from '../api-error-response'

jest.mock('../api-error-response', () => ({
  sendApiErrorResponse: jest.fn(() => 'test-reference')
}))

afterEach(() => {
  jest.clearAllMocks()
})

describe('resolvePermissionsForRole', () => {
  test('returns all permissions for the admin role', () => {
    const result = resolvePermissionsForRole({ role: 'admin' })

    expect(result.permissions.size).toBe(Object.keys(API_PERMISSIONS).length)
    for (const permission of Object.values(API_PERMISSIONS)) {
      expect(result.permissions.has(permission)).toBe(true)
    }
    expect(result.unknownPermissions).toEqual([])
    expect(result.roleIsUnknown).toBe(false)
  })

  test('applies overrides and captures unknown permissions', () => {
    const logger = { warn: jest.fn() }
    const result = resolvePermissionsForRole({
      role: 'operator',
      roleOverrides: {
        operator: ['monitoring:read', 'unknown:permission']
      },
      explicitPermissions: ['bedrock:list-models', 'invalid:permission'],
      logger
    })

    expect(result.permissions).toEqual(
      new Set([API_PERMISSIONS.MONITORING_READ, API_PERMISSIONS.BEDROCK_LIST_MODELS])
    )
    expect(result.unknownPermissions).toEqual(['unknown:permission', 'invalid:permission'])
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  test('falls back to observer permissions when the role is not recognised', () => {
    const logger = { warn: jest.fn() }
    const result = resolvePermissionsForRole({ role: 'guest', logger })

    expect(result.permissions).toEqual(new Set([API_PERMISSIONS.MONITORING_READ]))
    expect(result.roleIsUnknown).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith('Applying observer permissions to unknown API role', {
      role: 'guest'
    })
  })
})

describe('ensurePermission', () => {
  test('returns true only when the identity includes the permission', () => {
    const permissions = new Set([API_PERMISSIONS.MONITORING_READ])
    expect(
      ensurePermission(
        { role: API_ROLES[0], permissions, source: 'header', tokenFingerprint: 'abc' },
        API_PERMISSIONS.MONITORING_READ
      )
    ).toBe(true)
    expect(
      ensurePermission(
        { role: API_ROLES[0], permissions, source: 'header', tokenFingerprint: 'abc' },
        API_PERMISSIONS.BEDROCK_LIST_MODELS
      )
    ).toBe(false)
    expect(ensurePermission(undefined, API_PERMISSIONS.MONITORING_READ)).toBe(false)
  })
})

describe('createPermissionMiddleware', () => {
  const sendApiErrorResponseMock = jest.mocked(sendApiErrorResponse)

  test('responds with an internal error when the identity is missing', () => {
    const logger = { warn: jest.fn() }
    const middleware = createPermissionMiddleware({
      permission: API_PERMISSIONS.MONITORING_READ,
      logger
    })

    const req = { path: '/metrics', method: 'GET' } as unknown as Request
    const res = {} as Response
    const next = jest.fn()

    middleware(req, res, next)

    expect(sendApiErrorResponseMock).toHaveBeenCalledWith(res, 'internal_server_error')
    expect(next).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'Missing authentication identity on request before authorisation check',
      {
        method: 'GET',
        path: '/metrics',
        permission: API_PERMISSIONS.MONITORING_READ
      }
    )
  })

  test('responds with forbidden when the identity lacks the permission', () => {
    const logger = { warn: jest.fn() }
    const middleware = createPermissionMiddleware({
      permission: API_PERMISSIONS.BEDROCK_LIST_MODELS,
      logger
    })

    const req = {
      path: '/listModels',
      method: 'GET',
      authIdentity: {
        role: 'observer',
        permissions: new Set([API_PERMISSIONS.MONITORING_READ]),
        source: 'header',
        tokenFingerprint: 'fingerprint'
      }
    } as unknown as Request

    const res = {} as Response
    const next = jest.fn()

    middleware(req, res, next)

    expect(sendApiErrorResponseMock).toHaveBeenCalledWith(res, 'forbidden_request', {
      status: 403
    })
    expect(logger.warn).toHaveBeenCalledWith('Denied request due to insufficient permissions', {
      method: 'GET',
      path: '/listModels',
      permission: API_PERMISSIONS.BEDROCK_LIST_MODELS,
      referenceId: 'test-reference',
      role: 'observer',
      source: 'header',
      tokenFingerprint: 'fingerprint'
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('invokes next when the identity has the required permission', () => {
    const logger = { warn: jest.fn() }
    const middleware = createPermissionMiddleware({
      permission: API_PERMISSIONS.MONITORING_READ,
      logger
    })

    const req = {
      path: '/metrics',
      method: 'GET',
      authIdentity: {
        role: 'admin',
        permissions: new Set(Object.values(API_PERMISSIONS)),
        source: 'header',
        tokenFingerprint: 'fingerprint'
      }
    } as unknown as Request

    const res = {} as Response
    const next = jest.fn()

    middleware(req, res, next)

    expect(sendApiErrorResponseMock).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })
})
