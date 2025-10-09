type Listener = (...args: unknown[]) => unknown

jest.mock('electron', () => {
  const handleMap = new Map<string, Listener>()
  const onMap = new Map<string, Listener>()
  const mockHandle = jest.fn((channel: string, listener: Listener) => {
    handleMap.set(channel, listener)
  })
  const mockOn = jest.fn((channel: string, listener: Listener) => {
    onMap.set(channel, listener)
  })

  return {
    ipcMain: {
      handle: mockHandle,
      on: mockOn
    },
    __ipcMocks: {
      mockHandle,
      mockOn,
      handleMap,
      onMap
    }
  }
})

const {
  __ipcMocks: { mockHandle, mockOn, handleMap, onMap }
} = jest.requireMock('electron') as {
  __ipcMocks: {
    mockHandle: jest.Mock
    mockOn: jest.Mock
    handleMap: Map<string, Listener>
    onMap: Map<string, Listener>
  }
}

jest.mock('../../../common/logger', () => {
  const loggerMocks: Record<string, jest.Mock> = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    verbose: jest.fn()
  }

  return {
    log: loggerMocks,
    createCategoryLogger: jest.fn(() => ({
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      verbose: jest.fn()
    })),
    __loggerMocks: loggerMocks
  }
})

const {
  __loggerMocks: baseLogger
} = jest.requireMock('../../../common/logger') as {
  __loggerMocks: Record<string, jest.Mock>
}

import {
  configureIpcSecurity,
  registerIpcHandler,
  registerLogHandler
} from '../../../main/lib/ipc-handler'

function createEvent(url: string) {
  return {
    senderFrame: { url },
    sender: {
      getURL: () => url,
      mainFrame: { url }
    }
  } as any
}

describe('IPC security hardening', () => {
  beforeEach(() => {
    handleMap.clear()
    onMap.clear()
    mockHandle.mockClear()
    mockOn.mockClear()
    Object.values(baseLogger).forEach((fn) => {
      fn.mockClear()
    })

    configureIpcSecurity({
      trustedOrigins: ['https://allowed.example'],
      allowFileProtocol: false
    })
  })

  test('allows IPC invocations from trusted origins only', async () => {
    registerIpcHandler('fetch-website', async () => ({
      status: 200,
      headers: {},
      data: null
    }))
    const handler = handleMap.get('fetch-website') as Listener
    expect(handler).toBeDefined()

    await expect(handler(createEvent('https://allowed.example/path'))).resolves.toEqual({
      status: 200,
      headers: {},
      data: null
    })

    await expect(handler(createEvent('https://malicious.example'))).rejects.toThrow(
      /Renderer origin is not allowed/
    )

    expect(baseLogger.warn).toHaveBeenCalledWith(
      'Rejected IPC request from untrusted renderer',
      expect.objectContaining({ channel: 'fetch-website' })
    )
  })

  test('blocks logger channel events from untrusted origins', () => {
    registerLogHandler()
    const listener = onMap.get('logger:log') as Listener
    expect(listener).toBeDefined()

    listener(createEvent('https://allowed.example'), {
      level: 'info',
      message: 'hello'
    })

    expect(baseLogger.warn).not.toHaveBeenCalledWith(
      'Blocked logger IPC event from untrusted renderer',
      expect.anything()
    )

    listener(createEvent('https://evil.example'), {
      level: 'info',
      message: 'blocked'
    })

    expect(baseLogger.warn).toHaveBeenCalledWith(
      'Blocked logger IPC event from untrusted renderer',
      expect.objectContaining({ error: expect.any(String) })
    )
  })
})
