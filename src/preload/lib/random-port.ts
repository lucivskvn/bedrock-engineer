const MAX_PORT = 65535
const MIN_PORT = 3500 // avoid wellknown port

const getRandomPort = async (beginPort?: number): Promise<number> => {
  const { default: getPort, portNumbers } = await import('get-port')
  const start = beginPort ?? MIN_PORT
  return getPort({ port: portNumbers(start, MAX_PORT) })
}

export default getRandomPort
