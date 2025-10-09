import { test, expect } from '@jest/globals'
import net from 'net'
import getRandomPort from '../../../preload/lib/random-port'
import http from 'http'

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once('error', () => {
      resolve(false)
    })
    tester.once('listening', () => {
      tester.close(() => resolve(true))
    })
    tester.listen(port)
  })
}

test('server port is released after close', async () => {
  const port = await getRandomPort()
  const server = http.createServer((_req, res) => res.end('ok'))
  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve())
  })

  // port should be in use while server is running
  const availableWhileRunning = await canListen(port)
  expect(availableWhileRunning).toBe(false)

  await new Promise<void>((resolve) => server.close(() => resolve()))

  const availableAfterClose = await canListen(port)
  expect(availableAfterClose).toBe(true)
})
