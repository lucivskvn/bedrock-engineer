import type { Response } from 'express'
import { createApiError, describeError, sendApiErrorResponse } from '../api-error-response'

describe('api-error-response', () => {
  it('creates payloads with metadata and reference id', () => {
    const payload = createApiError('invalid_request_payload', { field: 'value' }, 'ref-123')

    expect(payload).toEqual({
      code: 'invalid_request_payload',
      message: 'Invalid request payload',
      referenceId: 'ref-123',
      metadata: { field: 'value' }
    })
  })

  it('sends structured error responses, sets headers, and returns reference id', () => {
    const status = jest.fn().mockReturnThis()
    const json = jest.fn()
    const setHeader = jest.fn()
    const getHeader = jest.fn()
    const res = { status, json, setHeader, getHeader } as unknown as Response

    const referenceId = sendApiErrorResponse(res, 'internal_server_error', {
      status: 503,
      metadata: { reason: 'test' },
      referenceId: 'fixed-id'
    })

    expect(referenceId).toBe('fixed-id')
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'fixed-id')
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, no-cache, must-revalidate')
    expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache')
    expect(setHeader).toHaveBeenCalledWith('Expires', '0')
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8')
    expect(status).toHaveBeenCalledWith(503)
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'internal_server_error',
        message: 'Internal server error',
        referenceId: 'fixed-id',
        metadata: { reason: 'test' }
      }
    })
  })

  it('reuses existing request id header when provided', () => {
    const status = jest.fn().mockReturnThis()
    const json = jest.fn()
    const setHeader = jest.fn()
    const getHeader = jest.fn((header: string) =>
      header === 'X-Request-Id' ? 'existing-id' : undefined
    )
    const res = { status, json, setHeader, getHeader } as unknown as Response

    const referenceId = sendApiErrorResponse(res, 'invalid_request_payload', {
      metadata: { reason: 'validation_failed' }
    })

    expect(referenceId).toBe('existing-id')
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'existing-id')
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'invalid_request_payload',
        message: 'Invalid request payload',
        referenceId: 'existing-id',
        metadata: { reason: 'validation_failed' }
      }
    })
  })

  it('summarises Error instances without exposing message content', () => {
    const error = new Error('Sensitive details here')
    error.stack = 'Error: Sensitive details here\n    at line1\n    at line2'

    const summary = describeError(error)

    expect(summary).toMatchObject({
      name: 'Error',
      messageLength: 22,
      stackLength: expect.any(Number),
      stackFrames: 3
    })
    expect(Object.values(summary)).not.toContain('Sensitive details here')
  })

  it('summarises non-error values', () => {
    expect(describeError(undefined)).toEqual({ type: 'undefined' })
    expect(describeError(null)).toEqual({ type: 'null' })
    expect(describeError('boom')).toEqual({ type: 'string' })
  })
})
