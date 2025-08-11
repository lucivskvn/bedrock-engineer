import { IpcMainInvokeEvent, app } from 'electron'
import { spawn } from 'child_process'
import axios from 'axios'
import { log } from '../../common/logger'
import { store } from '../../preload/store'
import { createUtilProxyAgent } from '../lib/proxy-utils'
import { isUrlSafe } from '../lib/url-utils'

export const utilHandlers = {
  'get-app-path': async (_event: IpcMainInvokeEvent) => {
    return app.getAppPath()
  },

  'fetch-website': async (_event: IpcMainInvokeEvent, params: [string, any?]) => {
    const [url, options] = params
    try {
      // Validate URL and block private network access
      if (!(await isUrlSafe(url))) {
        throw new Error('Disallowed URL')
      }

      // Get proxy configuration from store
      const awsConfig = store.get('aws')
      const proxyAgents = createUtilProxyAgent(awsConfig?.proxyConfig)
      const axiosConfig: any = {
        method: options?.method || 'GET',
        url: url,
        timeout: options?.timeout ?? 10000,
        headers: {
          ...options?.headers,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }

      // Add request body if provided
      if (options?.body) {
        axiosConfig.data = options.body
      }

      // Apply appropriate proxy agent based on URL protocol
      if (proxyAgents) {
        const targetUrl = new URL(url)
        const agent = proxyAgents.httpsAgent

        if (targetUrl.protocol === 'https:') {
          axiosConfig.httpsAgent = agent
        } else {
          axiosConfig.httpAgent = agent
        }
      } else {
        log.debug('No proxy agent configured, using direct connection', { url })
      }

      const response = await axios(axiosConfig)

      return {
        status: response.status,
        headers: response.headers as Record<string, string>,
        data: response.data
      }
    } catch (error) {
      log.error('Error fetching website', {
        url,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  },

  'check-docker-availability': async (_event: IpcMainInvokeEvent) => {
    return new Promise((resolve) => {
      const dockerProcess = spawn('docker', ['--version'], { stdio: 'pipe' })

      let output = ''
      let errorOutput = ''

      dockerProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      dockerProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString()
      })

      dockerProcess.on('close', (code) => {
        if (code === 0 && output.includes('Docker version')) {
          // Extract version information
          const versionMatch = output.match(/Docker version (\d+\.\d+\.\d+)/)
          const version = versionMatch ? versionMatch[1] : 'Unknown'

          resolve({
            available: true,
            version,
            lastChecked: new Date()
          })
        } else {
          resolve({
            available: false,
            error: errorOutput || 'Docker not found or not running',
            lastChecked: new Date()
          })
        }
      })

      dockerProcess.on('error', (error) => {
        resolve({
          available: false,
          error: error.message,
          lastChecked: new Date()
        })
      })

      // Timeout after 5 seconds
      setTimeout(() => {
        dockerProcess.kill()
        resolve({
          available: false,
          error: 'Docker check timed out',
          lastChecked: new Date()
        })
      }, 5000)
    })
  }
} as const
