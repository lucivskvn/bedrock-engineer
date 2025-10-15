const MAX_PORT = 65535
const MIN_PORT = 3500 // avoid wellknown port

type GetPortModule = typeof import('get-port')

let portModule: GetPortModule | null = null

async function resolveGetPort(): Promise<GetPortModule> {
  if (!portModule) {
    // eslint-disable-next-line no-restricted-syntax -- get-port 7+ publishes only ESM builds
    portModule = await import('get-port')
  }

  return portModule
}

const getRandomPort = async (beginPort?: number): Promise<number> => {
  const start = beginPort ?? MIN_PORT
  const module = await resolveGetPort()
  return module.default({ port: module.portNumbers(start, MAX_PORT) })
}

export default getRandomPort
