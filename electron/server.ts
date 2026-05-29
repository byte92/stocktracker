import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { app } from 'electron'

const DEFAULT_PORT = 3218
const MAX_PORT_ATTEMPTS = 20
const HEALTH_CHECK_INTERVAL_MS = 500
const HEALTH_CHECK_TIMEOUT_MS = 30_000

function getNodeBinary(): string {
  // Try to find system Node.js (not Electron's built-in)
  // This is needed because native modules like better-sqlite3
  // are compiled for the system Node.js ABI, not Electron's
  const { execSync } = require('node:child_process') as typeof import('node:child_process')
  try {
    const nodePath = execSync('which node', { encoding: 'utf-8' }).trim()
    if (nodePath && !nodePath.includes('electron')) return nodePath
  } catch {}
  // Fallback to common paths
  const candidates = ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node']
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  // Last resort: use process.execPath (Electron's Node)
  return process.execPath
}

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
    // In packaged app: resources/app.asar.unpacked/.next/standalone/server.js
    // In development: projectRoot/.next/standalone/server.js
    const isPackaged = app.isPackaged
    let appPath = isPackaged ? process.resourcesPath : process.cwd()

    // If packaged, check if files are in asar.unpacked directory
    if (isPackaged) {
      const unpackedPath = path.join(appPath, 'app.asar.unpacked')
      if (fs.existsSync(unpackedPath)) {
        appPath = unpackedPath
      }
    }

    const standaloneDir = path.join(appPath, '.next', 'standalone')

    // Ensure static assets are available in standalone directory
    const staticSrc = path.join(appPath, '.next', 'static')
    const staticDest = path.join(standaloneDir, '.next', 'static')
    if (fs.existsSync(staticSrc) && !fs.existsSync(staticDest)) {
      fs.cpSync(staticSrc, staticDest, { recursive: true })
    }

    return path.join(standaloneDir, 'server.js')
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

    // Use system Node.js instead of Electron's built-in Node
    // to avoid native module ABI mismatch (better-sqlite3 compiled for system Node)
    const nodeBin = getNodeBinary()

    child = spawn(nodeBin, [serverScript], {
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
