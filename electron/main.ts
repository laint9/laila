import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell } from 'electron'
import { createReadStream, existsSync, mkdirSync, statSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { ClaudeService, DEFAULT_MODEL } from './claude'
import { scanFontDirs } from './fonts'
import { ALL_EXT, AUDIO_EXT, IMAGE_EXT, importPath, makeImageItem, VECTOR_EXT, VIDEO_EXT } from './importer'
import { extractFrame, FrameEncoder, makeFilmstrip, makeWaveform, probe, runExport } from './ffmpeg'
import type {
  AppSettings,
  ExportRequest,
  GenerateRequest,
  MediaItem,
  ReferenceRequest,
  SoundDesignRequest,
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
  // Cho phép đọc danh sách font cài trong máy (Local Font Access API)
  const ses = win.webContents.session
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'local-fonts')
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'local-fonts'))
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
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.ai': 'application/pdf',
    '.mkv': 'video/x-matroska',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.ttc': 'font/collection'
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
  // ---------- reference: trích khung hình rồi nhờ Claude phân tích ----------
  ipcMain.handle('reference:pick', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'Ảnh / video tham khảo', extensions: ['mp4', 'mov', 'm4v', 'webm', 'gif', 'png', 'jpg', 'jpeg', 'webp'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('reference:analyze', async (_e, reqId: string, req: ReferenceRequest) => {
    const ac = new AbortController()
    aborters.set(reqId, ac)
    try {
      const isImage = /\.(png|jpe?g|webp)$/i.test(req.path)
      const dir = join(userDir(), 'reference', randomUUID())
      mkdirSync(dir, { recursive: true })
      let duration = 0
      let times = [0]
      if (!isImage) {
        duration = (await probe(req.path)).duration
        // 2 khung/giây, tối thiểu 3, tối đa 8, rải đều trong đoạn
        const n = Math.max(3, Math.min(8, Math.round(duration * 2)))
        times = Array.from({ length: n }, (_, i) => duration * (0.04 + (0.92 * i) / Math.max(1, n - 1)))
      }
      const frames: { t: number; data: string }[] = []
      for (let i = 0; i < times.length; i++) {
        const out = join(dir, `f${i}.jpg`)
        await extractFrame(req.path, times[i], out)
        frames.push({ t: times[i], data: (await readFile(out)).toString('base64') })
      }
      return await claude.analyzeReference({ ...req, model: req.model || appSettings().model }, frames, duration, ac.signal)
    } finally {
      aborters.delete(reqId)
    }
  })

  ipcMain.handle('claude:sound', async (_e, reqId: string, req: SoundDesignRequest) => {
    const ac = new AbortController()
    aborters.set(reqId, ac)
    try {
      return await claude.designSound({ ...req, model: req.model || appSettings().model }, ac.signal)
    } finally {
      aborters.delete(reqId)
    }
  })

  // lưu file WAV do bộ tổng hợp âm thanh tạo ra -> media
  ipcMain.handle('audio:save', async (_e, name: string, data: Uint8Array) => {
    const dir = join(userDir(), 'audio')
    mkdirSync(dir, { recursive: true })
    const safe = name.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'audio'
    const path = join(dir, `${safe}_${Date.now()}.wav`)
    await writeFile(path, Buffer.from(data))
    const info = await probe(path)
    const item: MediaItem = { id: randomUUID(), kind: 'audio', name, path, duration: info.duration, hasAudio: true }
    return item
  })

  ipcMain.handle('claude:cancel', (_e, reqId: string) => {
    aborters.get(reqId)?.abort()
  })

  // Render frame-by-frame: renderer vẽ trong sandbox iframe, gửi PNG qua đây.
  ipcMain.handle('render:start', (_e, jobId: string, fps: number, label: string, alpha = false) => {
    const safe = label.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'scene'
    const path = join(rendersDir(), `${safe}_${Date.now()}_${jobId.slice(0, 6)}.${alpha ? 'webm' : 'mp4'}`)
    encoders.set(jobId, { enc: new FrameEncoder(path, fps, alpha), path })
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

  ipcMain.handle('media:import', async (_e, kind: 'video' | 'audio' | 'image' | 'all') => {
    const filters =
      kind === 'audio'
        ? [{ name: 'Âm thanh', extensions: AUDIO_EXT }]
        : kind === 'video'
          ? [{ name: 'Video', extensions: VIDEO_EXT }]
          : kind === 'image'
            ? [{ name: 'Ảnh & vector', extensions: [...IMAGE_EXT, ...VECTOR_EXT] }]
            : [{ name: 'Video, ảnh, vector, âm thanh', extensions: ALL_EXT }]
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], filters })
    if (r.canceled) return []
    return Promise.all(r.filePaths.map(importPath))
  })
  // file kéo thả từ Finder
  ipcMain.handle('media:importPaths', (_e, paths: string[]) => Promise.all(paths.filter((p) => existsSync(p)).map(importPath)))
  // file kéo thả không có đường dẫn (vd ảnh kéo từ trình duyệt): lưu lại rồi nhập như file thường
  ipcMain.handle('media:saveDropped', async (_e, name: string, data: Uint8Array) => {
    // mỗi file 1 thư mục riêng để giữ nguyên tên gốc
    const dir = join(userDir(), 'imported', randomUUID().slice(0, 8))
    mkdirSync(dir, { recursive: true })
    const out = join(dir, basename(name).replace(/[\\/:]+/g, '_') || 'file')
    await writeFile(out, data)
    return out
  })
  // PNG renderer vẽ từ vector (svg/pdf/ai)
  ipcMain.handle('media:saveRaster', async (_e, source: string, data: Uint8Array) => {
    const dir = join(userDir(), 'raster')
    mkdirSync(dir, { recursive: true })
    const out = join(dir, `${basename(source, extname(source)).replace(/[^\p{L}\p{N}._\- ]+/gu, '_')}-${randomUUID().slice(0, 8)}.png`)
    await writeFile(out, data)
    return makeImageItem(out, source)
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

  const waves = new Map<string, Promise<string | null>>()
  ipcMain.handle('media:waveform', (_e, path: string) => {
    if (!existsSync(path)) return null
    const key = path + ':' + statSync(path).mtimeMs
    let p = waves.get(key)
    if (!p) {
      const dir = join(userDir(), 'thumbs')
      mkdirSync(dir, { recursive: true })
      const out = join(dir, `${randomUUID()}.png`)
      p = makeWaveform(path, out).then(
        () => out,
        () => null
      )
      waves.set(key, p)
    }
    return p
  })

  ipcMain.handle('file:pickImage', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'Ảnh & vector', extensions: [...IMAGE_EXT, ...VECTOR_EXT] }]
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

// Theo dõi thư mục font: cài/xoá font thì báo renderer nạp lại danh sách
const fontWatchers: FSWatcher[] = []
function fontDirs() {
  return (
    process.platform === 'darwin'
      ? [join(homedir(), 'Library/Fonts'), '/Library/Fonts']
      : process.platform === 'win32'
        ? [join(process.env.WINDIR || 'C:/Windows', 'Fonts'), join(homedir(), 'AppData/Local/Microsoft/Windows/Fonts')]
        : [join(homedir(), '.local/share/fonts'), join(homedir(), '.fonts'), '/usr/share/fonts']
  )
}

function watchFonts() {
  const dirs = fontDirs()
  let timer: NodeJS.Timeout | null = null
  for (const d of dirs) {
    if (!existsSync(d)) continue
    try {
      fontWatchers.push(
        watch(d, { recursive: process.platform !== 'linux' }, () => {
          if (timer) clearTimeout(timer)
          // chờ macOS đăng ký font xong rồi mới báo
          timer = setTimeout(() => win?.webContents.send('fonts:changed'), 1500)
        })
      )
    } catch {
      /* thư mục không theo dõi được thì bỏ qua; vẫn còn nút Làm mới */
    }
  }
}

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
  watchFonts()
  ipcMain.handle('fonts:scan', () => scanFontDirs(fontDirs()))
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const { enc } of encoders.values()) enc.abort()
  if (process.platform !== 'darwin') app.quit()
})
