import { describe, expect, it } from '@jest/globals'
import type { PermissionCheckHandlerHandlerDetails, PermissionRequest } from 'electron'
import {
  getAllowedPermissions,
  isPermissionAllowed,
  isTrustedRendererUrl
} from '../../../main/security/policy'

const allowedOrigins = ['http://localhost:5173', 'https://app.example.com']

describe('isTrustedRendererUrl', () => {
  it('allows file protocol when enabled', () => {
    expect(isTrustedRendererUrl('file:///index.html', allowedOrigins, true)).toBe(true)
  })

  it('rejects file protocol when disabled', () => {
    expect(isTrustedRendererUrl('file:///index.html', allowedOrigins, false)).toBe(false)
  })

  it('allows known https origins', () => {
    expect(isTrustedRendererUrl('https://app.example.com/dashboard', allowedOrigins, true)).toBe(true)
  })

  it('rejects unknown https origins', () => {
    expect(isTrustedRendererUrl('https://evil.example', allowedOrigins, true)).toBe(false)
  })

  it('allows about:blank navigation', () => {
    expect(isTrustedRendererUrl('about:blank', allowedOrigins, true)).toBe(true)
  })

  it('rejects non-http(s) protocols', () => {
    expect(isTrustedRendererUrl('data:text/html;base64,PHNjcmlwdD4', allowedOrigins, true)).toBe(false)
  })
})

describe('isPermissionAllowed', () => {
  const baseDetails: PermissionRequest & { mediaTypes?: string[] } = {
    isMainFrame: true,
    requestingUrl: 'https://app.example.com',
    mediaTypes: ['audio']
  }

  it('allows audio/video media requests from trusted origins', () => {
    expect(
      isPermissionAllowed('media', baseDetails, {
        allowedOrigins,
        allowFileProtocol: true,
        origin: 'https://app.example.com'
      })
    ).toBe(true)
  })

  it('rejects media requests with unsupported types', () => {
    const details: PermissionRequest & { mediaTypes?: string[] } = {
      isMainFrame: true,
      requestingUrl: 'https://app.example.com',
      mediaTypes: ['screen']
    }
    expect(
      isPermissionAllowed('media', details, {
        allowedOrigins,
        allowFileProtocol: true,
        origin: 'https://app.example.com'
      })
    ).toBe(false)
  })

  it('rejects permissions from untrusted origins', () => {
    const details: PermissionRequest & { mediaTypes?: string[] } = {
      isMainFrame: true,
      requestingUrl: 'https://evil.example',
      mediaTypes: ['audio']
    }
    expect(
      isPermissionAllowed('media', details, {
        allowedOrigins,
        allowFileProtocol: true,
        origin: 'https://evil.example'
      })
    ).toBe(false)
  })

  it('allows clipboard permissions from trusted origins', () => {
    const details: PermissionCheckHandlerHandlerDetails = {
      requestingUrl: 'https://app.example.com',
      isMainFrame: true
    }
    expect(
      isPermissionAllowed('clipboard-read', details, {
        allowedOrigins,
        allowFileProtocol: true,
        origin: 'https://app.example.com'
      })
    ).toBe(true)
  })

  it('rejects disallowed permissions', () => {
    const details: PermissionCheckHandlerHandlerDetails = {
      requestingUrl: 'https://app.example.com',
      isMainFrame: true
    }
    expect(
      isPermissionAllowed('geolocation', details, {
        allowedOrigins,
        allowFileProtocol: true,
        origin: 'https://app.example.com'
      })
    ).toBe(false)
  })
})

describe('getAllowedPermissions', () => {
  it('includes expected permission set', () => {
    expect(Array.from(getAllowedPermissions()).sort()).toEqual(
      ['camera', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'media', 'microphone'].sort()
    )
  })
})
