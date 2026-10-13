import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell } from 'electron'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { ClaudeService, DEFAULT_MODEL } from './claude'
import { FrameEncoder, makeFilmstrip, probe, runExport } from './ffmpeg'
import type {
  AppSettings,
  ExportRequest,
  GenerateRequest,
  MediaItem,
  Project,
  StoryboardRequest
} from '../shared/types'

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } }
])

const userDir = () => app.getPath('userData')
const rendersDir = () => {
  const d = join(userDir(), 'renders')
  mkdirSync(d, { recursive: true })
  return d
}
const settingsPath = () => join(userDir(), 'settings.json')
const autosavePath = () => join(userDir(), 'autosave.laila.json')

// ---------- settings / API key ----------

interface StoredSettings {
  apiKey?: string // base64, mã hoá bằng Keychain qua safeStorage
  apiKeyPlain?: string // chỉ dùng khi safeStorage không khả dụng
  model?: string
}

let stored: StoredSettings = {}

async function loadSettings() {
  try {
    stored = JSON.parse(await readFile(settingsPath(), 'utf8'))
  } catch {
    stored = {}
  }
}
const saveSettings = () => writeFile(settingsPath(), JSON.stringify(stored, null, 2))

function getApiKey(): string | undefined {
  if (stored.apiKey && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.apiKey, 'base64'))
    } catch {
      /* key hỏng: rơi xuống env */
    }
  }
  return stored.apiKeyPlain || process.env.ANTHROPIC_API_KEY || undefined
}

function appSettings(): AppSettings {
  const hasStored = !!(stored.apiKey || stored.apiKeyPlain)
  return {
    hasApiKey: !!getApiKey(),
    keySource: hasStored ? 'stored' : process.env.ANTHROPIC_API_KEY ? 'env' : 'none',
    model: stored.model || DEFAULT_MODEL
  }
}

const claude = new ClaudeService(getApiKey)

// ---------- window ----------

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#111214',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // Không cho mở link ngoài trong app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// media://local/<encoded path> -> file trên đĩa, hỗ trợ Range để <video> tua được.
function registerMediaProtocol() {
  const MIME: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  }
  protocol.handle('media', (req) => {
    const url = new URL(req.url)
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!existsSync(filePath)) return new Response('not found', { status: 404 })
    const size = statSync(filePath).size
    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const range = req.headers.get('range')
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    }
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/)
      let start = m && m[1] ? Number(m[1]) : 0
      let end = m && m[2] ? Number(m[2]) : size - 1
      if (m && !m[1] && m[2]) {
        start = size - Number(m[2])
        end = size - 1
      }
      end = Math.min(end, size - 1)
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
      return new Response(stream, {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
      })
    }
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
    return new Response(stream, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
  })
}

// ---------- IPC ----------

const aborters = new Map<string, AbortController>()
const encoders = new Map<string, { enc: FrameEncoder; path: string }>()
let exportJob: { cancel: () => void } | null = null

function registerIpc() {
  ipcMain.handle('settings:get', () => appSettings())
  ipcMain.handle('settings:setKey', async (_e, key: string) => {
    const k = key.trim()
    delete stored.apiKey
    delete stored.apiKeyPlain
    if (k) {
      if (safeStorage.isEncryptionAvailable()) stored.apiKey = safeStorage.encryptString(k).toString('base64')
      else stored.apiKeyPlain = k
    }
    await saveSettings()
    return appSettings()
  })
  ipcMain.handle('settings:setModel', async (_e, model: string) => {
    stored.model = model.trim() || DEFAULT_MODEL
    await saveSettings()
    return appSettings()
  })

  ipcMain.handle('claude:generate', async (_e, reqId: string, req: GenerateRequest) => {
    const ac = new AbortController()
    aborters.set(reqId, ac)
    try {
      return await claude.generateScene({ ...req, model: req.model || appSettings().model }, ac.signal)
    } finally {
      aborters.delete(reqId)
    }
  })
  ipcMain.handle('claude:storyboard', async (_e, reqId: string, req: StoryboardRequest) => {
    const ac = new AbortController()
    aborters.set(reqId, ac)
    try {
      return await claude.storyboard({ ...req, model: req.model || appSettings().model }, ac.signal)
    } finally {
      aborters.delete(reqId)
    }
  })
  ipcMain.handle('claude:cancel', (_e, reqId: string) => {
    aborters.get(reqId)?.abort()
  })

  // Render frame-by-frame: renderer vẽ trong sandbox iframe, gửi PNG qua đây.
  ipcMain.handle('render:start', (_e, jobId: string, fps: number, label: string) => {
    const safe = label.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'scene'
    const path = join(rendersDir(), `${safe}_${Date.now()}_${jobId.slice(0, 6)}.mp4`)
    encoders.set(jobId, { enc: new FrameEncoder(path, fps), path })
    return path
  })
  ipcMain.handle('render:frame', async (_e, jobId: string, frame: Uint8Array) => {
    const job = encoders.get(jobId)
    if (!job) throw new Error('render job không tồn tại')
    await job.enc.write(frame)
  })
  ipcMain.handle('render:finish', async (_e, jobId: string) => {
    const job = encoders.get(jobId)
    if (!job) throw new Error('render job không tồn tại')
    encoders.delete(jobId)
    await job.enc.finish()
    return { path: job.path, ...(await probe(job.path)) }
  })
  ipcMain.handle('render:abort', (_e, jobId: string) => {
    encoders.get(jobId)?.enc.abort()
    encoders.delete(jobId)
  })

  ipcMain.handle('media:import', async (_e, kind: 'video' | 'audio') => {
    const filters =
      kind === 'audio'
        ? [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'aac'] }]
        : [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm'] }]
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], filters })
    if (r.canceled) return []
    const items: MediaItem[] = []
    for (const p of r.filePaths) {
      const info = await probe(p)
      items.push({
        id: randomUUID(),
        kind,
        name: basename(p),
        path: p,
        duration: info.duration,
        hasAudio: info.hasAudio,
        width: info.width,
        height: info.height
      })
    }
    return items
  })

  // filmstrip cho timeline, cache theo đường dẫn + thời gian sửa file
  const strips = new Map<string, Promise<string | null>>()
  ipcMain.handle('media:filmstrip', (_e, path: string, duration: number) => {
    if (!existsSync(path)) return null
    const key = path + ':' + statSync(path).mtimeMs
    let p = strips.get(key)
    if (!p) {
      const dir = join(userDir(), 'thumbs')
      mkdirSync(dir, { recursive: true })
      const out = join(dir, `${randomUUID()}.jpg`)
      p = makeFilmstrip(path, out, duration).then(
        () => out,
        () => null
      )
      strips.set(key, p)
    }
    return p
  })

  ipcMain.handle('file:pickImage', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('file:exists', (_e, p: string) => existsSync(p))
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))

  ipcMain.handle('export:pick', async (_e, name: string) => {
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: join(app.getPath('videos'), `${name || 'video'}.mp4`),
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    })
    return r.canceled ? null : r.filePath
  })
  ipcMain.handle('export:run', async (e, req: ExportRequest) => {
    if (exportJob) throw new Error('Đang có một bản xuất chạy')
    const job = runExport(req, (p) => e.sender.send('export:progress', p))
    exportJob = job
    try {
      await job.promise
    } finally {
      exportJob = null
    }
  })
  ipcMain.handle('export:cancel', () => exportJob?.cancel())

  ipcMain.handle('project:autosave', (_e, project: Project) => writeFile(autosavePath(), JSON.stringify(project)))
  ipcMain.handle('project:loadAutosave', async () => {
    try {
      return JSON.parse(await readFile(autosavePath(), 'utf8')) as Project
    } catch {
      return null
    }
  })
  ipcMain.handle('project:saveAs', async (_e, project: Project) => {
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: join(app.getPath('documents'), `${project.name || 'project'}.ccmotion.json`),
      filters: [{ name: 'CC Motion Editor project', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    await writeFile(r.filePath, JSON.stringify(project, null, 2))
    return r.filePath
  })
  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'CC Motion Editor project', extensions: ['json'] }]
    })
    if (r.canceled) return null
    return JSON.parse(await readFile(r.filePaths[0], 'utf8')) as Project
  })
}

app.setName('CC Motion Editor')

app.whenReady().then(async () => {
  app.setAboutPanelOptions({
    applicationName: 'CC Motion Editor',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Chợ Chời Creative Studio',
    credits: 'Phát triển bởi Chợ Chời Creative Studio. Motion graphic tạo bằng Claude.'
  })
  await loadSettings()
  registerMediaProtocol()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const { enc } of encoders.values()) enc.abort()
  if (process.platform !== 'darwin') app.quit()
})
