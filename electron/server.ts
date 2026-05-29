import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'

const DEFAULT_PORT = 3218
const MAX_PORT_ATTEMPTS = 20
const HEALTH_CHECK_INTERVAL_MS = 500
const HEALTH_CHECK_TIMEOUT_MS = 30_000

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset++) {
    const port = startPort + offset
    if (port > 65535) break
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`No available port found from ${startPort}`)
}

function waitForReady(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs

    const check = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Server not ready within ${timeoutMs}ms`))
        return
      }

      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) {
          resolve()
        } else {
          setTimeout(check, HEALTH_CHECK_INTERVAL_MS)
        }
      })

      req.on('error', () => setTimeout(check, HEALTH_CHECK_INTERVAL_MS))
      req.setTimeout(2000, () => {
        req.destroy()
        setTimeout(check, HEALTH_CHECK_INTERVAL_MS)
      })
    }

    check()
  })
}

export interface ServerManagerOptions {
  port?: number
  userDataPath: string
}

export interface ServerManager {
  start(): Promise<{ port: number }>
  stop(): Promise<void>
  isReady(): boolean
  getPort(): number | null
}

export function createServerManager(options: ServerManagerOptions): ServerManager {
  let child: ChildProcess | null = null
  let port: number | null = null
  let ready = false

  function getServerScript(): string {
    // In packaged app: resources/.next/standalone/server.js
    // In development: projectRoot/.next/standalone/server.js
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    const appPath =
      typeof resourcesPath === 'string' && process.env.NODE_ENV !== 'development'
        ? resourcesPath
        : process.cwd()
    return path.join(appPath, '.next', 'standalone', 'server.js')
  }

  async function start(): Promise<{ port: number }> {
    const serverScript = getServerScript()

    if (!fs.existsSync(serverScript)) {
      throw new Error(`Next.js standalone server not found at: ${serverScript}`)
    }

    port = await findAvailablePort(options.port ?? DEFAULT_PORT)

    const env = {
      ...process.env,
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'production' as const,
      FINANCE_SQLITE_PATH: path.join(options.userDataPath, 'finance.sqlite'),
    }

    child = spawn(process.execPath, [serverScript], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.dirname(serverScript),
    })

    child.stdout?.on('data', (data: Buffer) => {
      console.log(`[server] ${data.toString().trim()}`)
    })

    child.stderr?.on('data', (data: Buffer) => {
      console.error(`[server] ${data.toString().trim()}`)
    })

    child.on('exit', (code, signal) => {
      console.log(`[server] exited with code=${code} signal=${signal}`)
      ready = false
    })

    await waitForReady(port, HEALTH_CHECK_TIMEOUT_MS)
    ready = true
    console.log(`[server] ready on http://127.0.0.1:${port}`)

    return { port }
  }

  async function stop(): Promise<void> {
    if (child) {
      child.kill('SIGTERM')

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child?.kill('SIGKILL')
          resolve()
        }, 3000)

        child!.on('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      })

      child = null
    }

    ready = false
    port = null
  }

  return {
    start,
    stop,
    isReady: () => ready,
    getPort: () => port,
  }
}
