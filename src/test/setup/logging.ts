import { createBufferedConsoleWriter, setConsoleWriter } from '../../common/logger/utils'

declare global {
  var __LOGGER_BUFFER__: ReturnType<typeof createBufferedConsoleWriter> | undefined
}

const buffer = createBufferedConsoleWriter()

beforeAll(() => {
  globalThis.__LOGGER_BUFFER__ = buffer
  setConsoleWriter(buffer.write)
})

afterEach(() => {
  buffer.clear()
})

afterAll(() => {
  setConsoleWriter()
  delete globalThis.__LOGGER_BUFFER__
})

export const getLoggerBuffer = () => {
  const shared = globalThis.__LOGGER_BUFFER__
  if (!shared) {
    throw new Error('Logger buffer is not initialised for this test run.')
  }

  return shared
}
