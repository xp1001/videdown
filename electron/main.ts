import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

// 获取 yt-dlp 路径
function getYtDlpPath(): string {
  const possiblePaths = [
    path.join(process.env.APP_ROOT, 'yt-dlp.exe'),
    path.join(process.resourcesPath || '', 'yt-dlp.exe'),
    path.join(__dirname, '..', '..', 'yt-dlp.exe'),
  ]
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p
    }
  }
  return 'yt-dlp.exe'
}

// 获取 ffmpeg 路径（跨平台）
function getFfmpegPath(): string {
  const platform = process.platform
  const isWin = platform === 'win32'
  const ffmpegName = isWin ? 'ffmpeg.exe' : 'ffmpeg'
  
  // 可能的 FFmpeg 路径
  const possiblePaths = [
    // 1. 项目目录（开发环境）
    path.join(process.env.APP_ROOT || '', ffmpegName),
    path.join(process.resourcesPath || '', ffmpegName),
    path.join(__dirname, '..', '..', ffmpegName),
    // 2. 当前目录
    path.join(process.cwd(), ffmpegName),
    // 3. 系统 PATH 中的 ffmpeg
    ffmpegName
  ]
  
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        return p
      }
    } catch {
      // 忽略错误，继续检查下一个
    }
  }
  
  // 默认返回 ffmpeg，依赖系统 PATH
  return ffmpegName
}

// 获取 JS 运行时路径（用于 YouTube JS 解密）
// 优先使用 Node.js，因为它更常见且 yt-dlp 支持更好
function getJsRuntimePath(): string | null {
  const platform = process.platform
  const isWin = platform === 'win32'
  
  // 1. 首先尝试 Node.js（yt-dlp 支持 node 运行时）
  const nodeName = isWin ? 'node.exe' : 'node'
  const nodePaths = [
    // 系统 PATH 中的 node
    nodeName,
    // 常见安装路径
    isWin ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/bin/node',
    isWin ? 'C:\\Program Files (x86)\\nodejs\\node.exe' : '/usr/local/bin/node',
    isWin ? 'D:\\NodeJs\\node.exe' : '',
    isWin ? 'E:\\NodeJs\\node.exe' : '',
  ]
  
  for (const p of nodePaths) {
    try {
      if (fs.existsSync(p)) {
        return p
      }
    } catch {
      // 忽略错误，继续检查下一个
    }
  }
  
  // 2. 尝试 Deno
  const denoName = isWin ? 'deno.exe' : 'deno'
  const denoPaths = [
    denoName,
    path.join(process.env.APP_ROOT || '', denoName),
    path.join(process.resourcesPath || '', denoName),
    path.join(__dirname, '..', '..', denoName),
    path.join(process.cwd(), denoName),
  ]
  
  for (const p of denoPaths) {
    try {
      if (fs.existsSync(p)) {
        return p
      }
    } catch {
      // 忽略错误，继续检查下一个
    }
  }
  
  return null
}

// 检查 ffmpeg 是否可用（保留供将来使用）
// @ts-ignore
async function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn(getFfmpegPath(), ['-version'])
    ffmpeg.on('error', () => resolve(false))
    ffmpeg.on('close', (code) => resolve(code === 0))
  })
}

// 检查是否是抖音链接
function isDouyinUrl(url: string): boolean {
  return url.includes('douyin.com') || url.includes('v.douyin.com')
}

// 检查是否是快手链接
function isKuaishouUrl(url: string): boolean {
  return url.includes('kuaishou.com') || url.includes('v.kuaishou.com')
}

// 检查是否是B站链接（保留供将来使用）
// @ts-ignore
function isBilibiliUrl(url: string): boolean {
  return url.includes('bilibili.com') || url.includes('b23.tv')
}

// 默认下载目录
function getDefaultDownloadDir(): string {
  return path.join(os.homedir(), 'Downloads', 'Videdown')
}

// 确保下载目录存在
function ensureDownloadDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

// 发送下载进度到所有窗口
function sendDownloadProgress(data: any) {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('download:progress', data)
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    icon: path.join(process.env.APP_ROOT || '', 'ldstore.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  createWindow()
  createMenu()
})

// 创建自定义菜单
function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit()
          }
        }
      ]
    },
    {
      label: '窗口',
      submenu: [
        {
          label: '最小化',
          accelerator: 'CmdOrCtrl+M',
          role: 'minimize'
        },
        {
          label: '关闭',
          accelerator: 'CmdOrCtrl+W',
          role: 'close'
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            // 发送消息到渲染进程，切换到关于页面
            win?.webContents.send('menu:showAbout')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// GitHub 仓库配置
const GITHUB_OWNER = 'cshuangyy'
const GITHUB_REPO = 'videdown'

// 获取应用版本号
ipcMain.handle('app:getVersion', () => {
  return app.getVersion()
})

// 手动检查更新（使用 GitHub API）
ipcMain.handle('app:checkForUpdates', async () => {
  try {
    const currentVersion = app.getVersion()
    
    // 使用 GitHub API 获取最新 Release
    // 添加 User-Agent 和 Accept 头以避免 API 限制
    const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`, {
      headers: {
        'User-Agent': `Videdown/${currentVersion}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    })
    
    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('API 请求频率受限，请稍后再试')
      } else if (response.status === 404) {
        throw new Error('未找到发布版本')
      } else {
        throw new Error(`服务器返回错误: ${response.status}`)
      }
    }
    
    const release = await response.json()
    const latestVersion = release.tag_name?.replace(/^v/, '') || ''
    
    if (!latestVersion) {
      throw new Error('无法解析版本号')
    }
    
    // 版本号对比
    const hasUpdate = compareVersion(latestVersion, currentVersion) > 0
    
    return {
      hasUpdate,
      version: latestVersion,
      currentVersion,
      releaseNotes: release.body || '',
      releaseDate: release.created_at || '',
      downloadUrl: release.html_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
    }
  } catch (error) {
    console.error('检查更新失败:', error)
    return {
      hasUpdate: false,
      error: error instanceof Error ? error.message : '检查更新失败，请检查网络连接',
    }
  }
})

// 版本号对比函数
function compareVersion(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    
    if (p1 > p2) return 1
    if (p1 < p2) return -1
  }
  
  return 0
}

// IPC 处理程序

// 粘贴剪贴板内容
ipcMain.handle('clipboard:readText', async () => {
  const { clipboard } = await import('electron')
  return clipboard.readText()
})

// 写入剪贴板内容
ipcMain.handle('clipboard:writeText', async (_, text: string) => {
  const { clipboard } = await import('electron')
  clipboard.writeText(text)
})

// 选择下载目录
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    defaultPath: getDefaultDownloadDir(),
  })
  return result.canceled ? null : result.filePaths[0]
})

// 选择文件对话框
ipcMain.handle('dialog:selectFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return result.canceled ? null : result.filePaths[0]
})

// 获取默认下载目录
ipcMain.handle('app:getDefaultDownloadDir', () => {
  return getDefaultDownloadDir()
})

// 打开下载文件夹
ipcMain.handle('shell:openPath', async (_, filePath: string) => {
  await shell.openPath(filePath)
})

// 打开外部链接
ipcMain.handle('shell:openExternal', async (_, url: string) => {
  await shell.openExternal(url)
})

// 使用直接 API 调用快速解析抖音视频
async function parseDouyinWithAPI(url: string): Promise<any> {
  // 从 URL 中提取视频 ID
  let videoId: string | null = null
  
  // 尝试多种 URL 格式
  // 1. https://www.douyin.com/video/7082345237837899051
  const videoMatch = url.match(/\/video\/(\d+)/)
  if (videoMatch) {
    videoId = videoMatch[1]
  }
  
  // 2. 短链接格式 https://v.douyin.com/xxxxx
  if (!videoId) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      const redirectedUrl = response.url
      const newVideoMatch = redirectedUrl.match(/\/video\/(\d+)/)
      if (newVideoMatch) {
        videoId = newVideoMatch[1]
      }
    } catch (e) {
    }
  }
  
  if (!videoId) {
    throw new Error('无法从 URL 提取视频 ID')
  }
  
  // 调用抖音 API - 增加更多参数提高成功率
  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&aid=6383&channel=channel_pc_web&detail_list=1`
  
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.douyin.com/',
      'Accept': 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    }
  })
  
  const data = await response.json()
  
  if (!data.aweme_detail) {
    throw new Error('API 解析失败')
  }
  
  const detail = data.aweme_detail
  const video = detail.video
  
  // 用于去重，只保留每个清晰度的最佳版本
  const qualityMap = new Map<string, any>()
  
  // 处理 bit_rate 中的各种清晰度
  if (video.bit_rate && video.bit_rate.length > 0) {
    video.bit_rate.forEach((br: any, index: number) => {
      if (br.play_addr?.url_list[0]) {
        let quality = '默认'
        let qualityKey = 'default'
        let height = br.height || 0
        
        if (br.gear_name) {
          const match = br.gear_name.match(/(\d+)/)
          if (match) {
            quality = `${match[1]}p`
            qualityKey = match[1]
            height = parseInt(match[1])
          } else {
            quality = br.gear_name
            qualityKey = br.gear_name
          }
        } else if (br.height) {
          quality = `${br.height}p`
          qualityKey = String(br.height)
        }
        
        let filesize = br.data_size || 0
        if (!filesize && video.duration) {
          const durationSec = video.duration / 1000
          let estimatedBitrate = 2000000
          if (height >= 1080) estimatedBitrate = 5000000
          else if (height >= 720) estimatedBitrate = 2500000
          else if (height >= 480) estimatedBitrate = 1500000
          else if (height >= 360) estimatedBitrate = 800000
          filesize = Math.floor((estimatedBitrate * durationSec) / 8)
        }
        
        const existing = qualityMap.get(qualityKey)
        if (!existing || filesize > existing.filesize) {
          qualityMap.set(qualityKey, {
            formatId: `hd_${index}`,
            quality: quality,
            ext: 'mp4',
            filesize: filesize,
            width: br.width || 0,
            height: height,
            fps: br.fps || 30,
            hasAudio: true,
            url: br.play_addr.url_list[0]
          })
        }
      }
    })
  }
  
  // 如果没有从 bit_rate 获取到格式，尝试使用 play_addr
  if (qualityMap.size === 0 && video.play_addr) {
    const playAddr = video.play_addr
    let filesize = playAddr.data_size || 0
    
    if (!filesize && video.duration) {
      const durationSec = video.duration / 1000
      const height = playAddr.height || 720
      let estimatedBitrate = 2000000
      if (height >= 1080) estimatedBitrate = 5000000
      else if (height >= 720) estimatedBitrate = 2500000
      else if (height >= 480) estimatedBitrate = 1500000
      else if (height >= 360) estimatedBitrate = 800000
      filesize = Math.floor((estimatedBitrate * durationSec) / 8)
    }
    
    qualityMap.set('default', {
      formatId: 'normal',
      quality: '默认',
      ext: 'mp4',
      filesize: filesize,
      width: playAddr.width || 0,
      height: playAddr.height || 0,
      fps: 30,
      hasAudio: true,
      url: playAddr.url_list[0]
    })
  }
  
  const formats = Array.from(qualityMap.values())
    .filter(f => f.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0))
  
  return {
    id: detail.aweme_id,
    title: detail.desc || '抖音视频',
    description: detail.desc,
    thumbnail: detail.video?.cover?.url_list[0] || detail.video?.dynamic_cover?.url_list[0] || '',
    duration: detail.video?.duration ? Math.floor(detail.video.duration / 1000) : 0,
    uploader: detail.author?.nickname || '',
    webpageUrl: url,
    formats: formats
  }
}

// 使用无头浏览器解析抖音视频
async function parseDouyinWithPuppeteer(url: string): Promise<any> {
  // 获取 Chromium 路径：优先使用系统 Chrome/Edge，否则使用 Electron 内置的 Chromium
  const browserPaths = [
    // Chrome
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Edge
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]

  let chromePath = browserPaths.find(p => fs.existsSync(p))
  
  // 如果没有找到系统浏览器，使用 Electron 内置的 Chromium
  if (!chromePath) {
    // Electron 的可执行文件就是 Chromium
    chromePath = process.execPath
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  })

  try {
    const page = await browser.newPage()

    // 设置 User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

    // 设置视口
    await page.setViewport({ width: 1920, height: 1080 })

    // 存储拦截到的视频信息
    let videoInfo: any = null
    let videoData: any = null
    let renderData: any = null
    let finalUrl = url  // 初始值为传入的 URL

    // 拦截网络请求
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      request.continue()
    })

    page.on('response', async (response) => {
      const resUrl = response.url()

      // 拦截抖音视频详情 API
      if (resUrl.includes('/aweme/v1/web/aweme/detail/') ||
          resUrl.includes('/aweme/v1/aweme/detail/') ||
          resUrl.includes('/aweme/v1/multi/aweme/detail/')) {
        try {
          const data = await response.json()
          videoData = data
        } catch (e) {
          // 忽略非 JSON 响应
        }
      }
    })

    // 访问页面（短链接会重定向）
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // 等待页面加载
    await new Promise(resolve => setTimeout(resolve, 3000))

    // 获取最终 URL（处理短链接重定向）
    finalUrl = page.url()

    // 滚动页面触发视频加载
    await page.evaluate(async () => {
      const videoContainer = document.querySelector('.video-container') ||
                             document.querySelector('[data-e2e="video-container"]') ||
                             document.querySelector('.short-video') ||
                             document.body
      if (videoContainer) {
        videoContainer.scrollIntoView({ behavior: 'instant', block: 'center' })
      }
      await new Promise(r => setTimeout(r, 2000))
      
      const playBtn = document.querySelector('.play-button') ||
                      document.querySelector('[data-e2e="play-button"]') ||
                      document.querySelector('.video-play') ||
                      document.querySelector('.player-play')
      if (playBtn) {
        ;(playBtn as HTMLElement).click()
        await new Promise(r => setTimeout(r, 1000))
      }
    })

    // 尝试从页面 SSR 数据中提取
    renderData = await page.evaluate(() => {
      // 尝试从 window._SSR_HYDRATED_DATA 获取
      const ssrData = (window as any)._SSR_HYDRATED_DATA
      if (ssrData) {
        return { source: '_SSR_HYDRATED_DATA', data: ssrData }
      }

      // 尝试从 window.__INITIAL_STATE__ 获取
      const initialState = (window as any).__INITIAL_STATE__
      if (initialState) {
        return { source: '__INITIAL_STATE__', data: initialState }
      }

      // 尝试从 script 标签获取
      const scripts = document.querySelectorAll('script')
      for (const script of scripts) {
        const text = script.textContent || ''
        // 匹配 SSR_HYDRATED_DATA
        let match = text.match(/window\._SSR_HYDRATED_DATA\s*=\s*({[\s\S]+?});?\s*$/m)
        if (match) {
          try {
            return { source: 'script_SSR', data: JSON.parse(match[1]) }
          } catch (e) {
            // ignore
          }
        }
        // 匹配 __INITIAL_STATE__
        match = text.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?});?\s*$/m)
        if (match) {
          try {
            return { source: 'script_INITIAL', data: JSON.parse(match[1]) }
          } catch (e) {
            // ignore
          }
        }
      }
      return null
    })

    // 优先使用 API 数据，其次是 SSR 数据
    const detailData = videoData?.aweme_detail ||
                       renderData?.data?.aweme?.aweme_detail ||
                       renderData?.data?.app?.aweme_detail ||
                       renderData?.data?.aweme_detail

    if (detailData) {
      const detail = detailData
      const video = detail.video

      // 用于去重，只保留每个清晰度的最佳版本
      const qualityMap = new Map<string, any>()

      // 处理 bit_rate 中的各种清晰度
      if (video.bit_rate && video.bit_rate.length > 0) {
        video.bit_rate.forEach((br: any, index: number) => {
          if (br.play_addr?.url_list[0]) {
            // 从 gear_name 或 height 获取清晰度
            let quality = '默认'
            let qualityKey = 'default'
            let height = br.height || 0

            if (br.gear_name) {
              // 提取 gear_name 中的清晰度，如 "normal_720_0" -> "720p"
              const match = br.gear_name.match(/(\d+)/)
              if (match) {
                quality = `${match[1]}p`
                qualityKey = match[1]
                height = parseInt(match[1])
              } else {
                quality = br.gear_name
                qualityKey = br.gear_name
              }
            } else if (br.height) {
              quality = `${br.height}p`
              qualityKey = String(br.height)
            }

            // 只保留该清晰度下文件大小最大的
            let filesize = br.data_size || 0
            
            // 如果没有文件大小，使用码率和时长估算
            if (!filesize && video.duration) {
              // 抖音 duration 是毫秒，需要转换为秒
              const durationSec = video.duration / 1000
              // 估算码率：根据清晰度估算 (bps)
              let estimatedBitrate = 2000000 // 默认 2Mbps
              if (height >= 1080) estimatedBitrate = 5000000 // 1080p: 5Mbps
              else if (height >= 720) estimatedBitrate = 2500000 // 720p: 2.5Mbps
              else if (height >= 480) estimatedBitrate = 1500000 // 480p: 1.5Mbps
              else if (height >= 360) estimatedBitrate = 800000 // 360p: 0.8Mbps
              
              // 文件大小 = 码率 * 时长 / 8 (转换为字节)
              filesize = Math.floor((estimatedBitrate * durationSec) / 8)
            }
            
            const existing = qualityMap.get(qualityKey)

            if (!existing || filesize > existing.filesize) {
              qualityMap.set(qualityKey, {
                formatId: `hd_${index}`,
                quality: quality,
                ext: 'mp4',
                filesize: filesize,
                width: br.width || 0,
                height: height,
                fps: br.fps || 30,
                hasAudio: true,
                url: br.play_addr.url_list[0]
              })
            }
          }
        })
      }

      // 如果没有从 bit_rate 获取到格式，尝试使用 play_addr
      if (qualityMap.size === 0 && video.play_addr) {
        const playAddr = video.play_addr
        let filesize = playAddr.data_size || 0
        
        // 如果没有文件大小，使用码率和时长估算
        if (!filesize && video.duration) {
          const durationSec = video.duration / 1000
          const height = playAddr.height || 720
          let estimatedBitrate = 2000000
          if (height >= 1080) estimatedBitrate = 5000000
          else if (height >= 720) estimatedBitrate = 2500000
          else if (height >= 480) estimatedBitrate = 1500000
          else if (height >= 360) estimatedBitrate = 800000
          filesize = Math.floor((estimatedBitrate * durationSec) / 8)
        }
        
        qualityMap.set('default', {
          formatId: 'normal',
          quality: '默认',
          ext: 'mp4',
          filesize: filesize,
          width: playAddr.width || 0,
          height: playAddr.height || 0,
          fps: 30,
          hasAudio: true,
          url: playAddr.url_list[0]
        })
      }

      // 转换为数组并按高度降序排序（从高到低）
      const formats = Array.from(qualityMap.values())
        .filter(f => f.url)
        .sort((a, b) => (b.height || 0) - (a.height || 0))

      videoInfo = {
        id: detail.aweme_id,
        title: detail.desc || '抖音视频',
        description: detail.desc,
        thumbnail: detail.video?.cover?.url_list[0] || detail.video?.dynamic_cover?.url_list[0] || '',
        duration: detail.video?.duration ? Math.floor(detail.video.duration / 1000) : 0,
        uploader: detail.author?.nickname || '',
        webpageUrl: url,
        formats: formats
      }
    } else {
      // 如果 API 和 SSR 都失败，尝试从页面 DOM 提取
      videoInfo = await page.evaluate(() => {
        const videoEl = document.querySelector('video') as HTMLVideoElement
        const titleEl = document.querySelector('[data-e2e="video-desc"]') ||
                        document.querySelector('.title') ||
                        document.querySelector('h1')
        const authorEl = document.querySelector('[data-e2e="video-author"]') ||
                         document.querySelector('.author') ||
                         document.querySelector('[data-e2e="user-name"]')

        // 尝试获取视频 src
        let videoSrc: string | undefined = videoEl?.src
        if (!videoSrc) {
          const sourceEl = videoEl?.querySelector('source')
          videoSrc = sourceEl?.src
        }

        return {
          id: Date.now().toString(),
          title: titleEl?.textContent?.trim() || '抖音视频',
          description: titleEl?.textContent?.trim() || '',
          thumbnail: '',
          duration: videoEl?.duration || 0,
          uploader: authorEl?.textContent?.trim() || '',
          webpageUrl: window.location.href,
          formats: videoSrc ? [{
            formatId: 'default',
            quality: '默认',
            ext: 'mp4',
            filesize: 0,
            width: 0,
            height: 0,
            fps: 30,
            hasAudio: true,
            url: videoSrc
          }] : []
        }
      })
    }

    if (!videoInfo || videoInfo.formats.length === 0) {
      throw new Error('无法获取视频信息，请检查链接是否有效')
    }

    return videoInfo
  } finally {
    await browser.close()
  }
}

// 使用直接 API 调用快速解析快手视频
async function parseKuaishouWithAPI(url: string): Promise<any> {

  
  // 从 URL 中提取视频 ID
  let videoId: string | null = null
  let shortCode: string | null = null
  
  // 尝试 /short-video/xxx 格式
  const shortVideoMatch = url.match(/\/short-video\/([^?&#]+)/)
  if (shortVideoMatch) {
    videoId = shortVideoMatch[1]
  }
  
  // 尝试短链接 f/xxx 格式
  const shortLinkMatch = url.match(/\/f\/([^?&#]+)/)
  if (shortLinkMatch) {
    shortCode = shortLinkMatch[1]
  }
  

  
  // 如果有 shortCode，先获取重定向后的 URL
  if (shortCode && !videoId) {
    try {
      const fullUrl = `https://www.kuaishou.com/f/${shortCode}`
      const response = await fetch(fullUrl, {
        redirect: 'follow',
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      const redirectedUrl = response.url

      
      const newVideoMatch = redirectedUrl.match(/\/short-video\/([^?&#]+)/)
      if (newVideoMatch) {
        videoId = newVideoMatch[1]
      }
      
      // 提取 authorId 和 shareToken
      const authorIdMatch = redirectedUrl.match(/authorId=([^&#]+)/)
      const authorId = authorIdMatch ? authorIdMatch[1] : null
      const shareTokenMatch = redirectedUrl.match(/shareToken=([^&#]+)/)
      const shareToken = shareTokenMatch ? shareTokenMatch[1] : null
      
      // 如果获取到 videoId，直接调用 API
      if (videoId) {
        return await queryKuaishouVideoById(videoId, authorId)
      }
    } catch (e) {

    }
  }
  
  // 如果有 videoId，直接调用 API
  if (videoId) {
    const authorIdMatch = url.match(/authorId=([^&#]+)/)
    const authorId = authorIdMatch ? authorIdMatch[1] : null
    return await queryKuaishouVideoById(videoId, authorId)
  }
  
  throw new Error('无法从 URL 提取视频 ID')
}

// 通过视频 ID 查询快手 GraphQL API
async function queryKuaishouVideoById(videoId: string, authorId: string | null): Promise<any> {

  
  const query = {
    operationName: 'VisionVideoDetail',
    variables: { photoId: videoId },
    query: `query VisionVideoDetail($photoId: String!) {
      visionVideoDetail(photoId: $photoId) {
        status
        photo {
          id
          duration
          caption
          likeCount
          viewCount
          realLikeCount
          coverUrl
          photoUrl
          photoH265Url
          manifest {
            version
            businessType
            mediaType
            adaptationSet {
              id
              duration
              representation {
                id
                url
                width
                height
                avgBitrate
                size
                type
              }
            }
          }
        }
        llsid
      }
    }`
  }
  
  try {
    const response = await fetch('https://www.kuaishou.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify(query)
    })
    
    const result = await response.json()
    
    if (result?.data?.visionVideoDetail?.photo) {
      const photo = result.data.visionVideoDetail.photo
      
      
      // 构建格式列表
      const formats: any[] = []
      
      // 处理 manifest
      let manifestData = photo.manifest
      if (photo.manifest?.id) {
        // manifest 是引用，需要解析
      }
      
      const adaptationSet = manifestData?.adaptationSet
      if (adaptationSet?.representation) {
        adaptationSet.representation.forEach((rep: any, index: number) => {
          if (rep.url) {
            let filesize = rep.size || 0
            if (!filesize && photo.duration && rep.avgBitrate) {
              filesize = Math.floor((rep.avgBitrate * photo.duration) / 1000 / 8)
            } else if (!filesize && photo.duration) {
              const durationSec = photo.duration / 1000
              const height = rep.height || 720
              let estimatedBitrate = 2000000
              if (height >= 1080) estimatedBitrate = 5000000
              else if (height >= 720) estimatedBitrate = 2500000
              else if (height >= 480) estimatedBitrate = 1500000
              filesize = Math.floor((estimatedBitrate * durationSec) / 8)
            }
            
            formats.push({
              formatId: `ks_${index}`,
              quality: `${rep.height}p`,
              ext: 'mp4',
              filesize: filesize,
              width: rep.width || 0,
              height: rep.height || 0,
              fps: 30,
              hasAudio: true,
              url: rep.url
            })
          }
        })
      }
      
      // 如果没有 manifest 格式但有 photoUrl
      if (formats.length === 0 && photo.photoUrl) {
        let filesize = 0
        if (photo.duration) {
          const durationSec = photo.duration / 1000
          filesize = Math.floor((2000000 * durationSec) / 8) // 默认 2Mbps
        }
        formats.push({
          formatId: 'default',
          quality: '默认',
          ext: 'mp4',
          filesize: filesize,
          width: 0,
          height: 0,
          fps: 30,
          hasAudio: true,
          url: photo.photoUrl
        })
      }
      
      formats.sort((a, b) => (b.height || 0) - (a.height || 0))
      
      return {
        id: photo.id,
        title: photo.caption || '快手视频',
        description: photo.caption,
        thumbnail: photo.coverUrl || '',
        duration: photo.duration ? Math.floor(photo.duration / 1000) : 0,
        uploader: '',
        webpageUrl: `https://www.kuaishou.com/short-video/${videoId}`,
        formats: formats
      }
    }
  } catch (e) {

  }
  
  throw new Error('API 解析失败')
}

// 使用无头浏览器解析快手视频
async function parseKuaishouWithPuppeteer(url: string): Promise<any> {
  // 获取 Chromium 路径：优先使用系统 Chrome/Edge，否则使用 Electron 内置的 Chromium
  const browserPaths = [
    // Chrome
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Edge
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]

  let chromePath = browserPaths.find(p => fs.existsSync(p))
  
  // 如果没有找到系统浏览器，使用 Electron 内置的 Chromium
  if (!chromePath) {
    // Electron 的可执行文件就是 Chromium
    chromePath = process.execPath
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  })

  try {
    const page = await browser.newPage()

    // 设置 User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

    // 设置视口
    await page.setViewport({ width: 1920, height: 1080 })

    // 存储拦截到的视频信息
    let videoInfo: any = null
    let videoData: any = null
    let renderData: any = null
    let finalUrl = url  // 初始值为传入的 URL

    // 拦截网络请求
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      request.continue()
    })

    page.on('response', async (response) => {
      const resUrl = response.url()

      // 拦截快手视频详情 API - 扩展更多 API 路径
      if (resUrl.includes('/graphql') || 
          resUrl.includes('/rest/wd/photo/info') || 
          resUrl.includes('/rest/wd/photo/detail') ||
          resUrl.includes('/api') ||
          resUrl.includes('/v1/')) {
        try {
          const data = await response.json()

          if (data?.data?.visionVideoDetail || data?.data?.videoDetail || data?.data?.photo || data?.data) {

            videoData = data
          }
        } catch (e) {
          // 忽略非 JSON 响应
        }
      }
    })

    // 访问页面
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // 等待视频元素加载（减少超时）
    try {
      await page.waitForSelector('video', { timeout: 5000 })

    } catch (e) {

    }
    
    // 减少滚动等待时间
    try {
      await page.evaluate(() => {
        window.scrollTo(0, 200)
      })
      await new Promise(resolve => setTimeout(resolve, 1000))
      await page.evaluate(() => {
        window.scrollTo(0, 0)
      })
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (e) {

    }
    
    // 减少额外等待时间
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // 更新 finalUrl
    finalUrl = page.url()


    // 从 URL 中提取视频 ID 并手动请求视频详情
    const videoIdMatch = finalUrl.match(/\/short-video\/([^?&#]+)/) || url.match(/\/short-video\/([^?&#]+)/)
    const videoId = videoIdMatch ? videoIdMatch[1] : null
    
    // 尝试从多个参数中提取视频 ID
    const shareTokenMatch = finalUrl.match(/shareToken=([^&#]+)/) || url.match(/shareToken=([^&#]+)/)
    const shareToken = shareTokenMatch ? shareTokenMatch[1] : null
    

    
    if (videoId) {
      // 手动发送 GraphQL 请求获取视频详情
      try {
        const graphqlQuery = {
          operationName: 'VisionVideoDetail',
          variables: { photoId: videoId },
          query: `query VisionVideoDetail($photoId: String!) {
            visionVideoDetail(photoId: $photoId) {
              status
              photo {
                id
                duration
                caption
                likeCount
                viewCount
                realLikeCount
                coverUrl
                photoUrl
                photoH265Url
                manifest {
                  version
                  businessType
                  mediaType
                  adaptationSet {
                    id
                    duration
                  }
                }
              }
              llsid
            }
          }`
        }
        
        const response = await page.evaluate(async (query) => {
          const res = await fetch('https://www.kuaishou.com/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(query)
          })
          return await res.json()
        }, graphqlQuery)
        
        if (response?.data?.visionVideoDetail?.photo) {
          videoData = response
        }
      } catch (e) {
      }
    }

    // 尝试从页面 SSR 数据中提取
    renderData = await page.evaluate(() => {
      // 尝试从 window.__INITIAL_STATE__ 获取
      const initialState = (window as any).__INITIAL_STATE__
      if (initialState) {
        return { source: '__INITIAL_STATE__', data: initialState }
      }

      // 尝试从 window.__APOLLO_STATE__ 获取
      const apolloState = (window as any).__APOLLO_STATE__
      if (apolloState) {
        return { source: '__APOLLO_STATE__', data: apolloState }
      }

      // 尝试从 window.__DATA__ 获取（快手常用）
      const windowData = (window as any).__DATA__
      if (windowData) {
        return { source: '__DATA__', data: windowData }
      }

      // 尝试从 window.KS_DATA 获取
      const ksData = (window as any).KS_DATA
      if (ksData) {
        return { source: 'KS_DATA', data: ksData }
      }

      // 尝试从 script 标签获取
      const scripts = document.querySelectorAll('script')
      for (const script of scripts) {
        const text = script.textContent || ''
        // 匹配 __INITIAL_STATE__
        let match = text.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?});?\s*$/m)
        if (match) {
          try {
            return { source: 'script_INITIAL', data: JSON.parse(match[1]) }
          } catch (e) {
            // ignore
          }
        }
        // 匹配 __APOLLO_STATE__
        match = text.match(/window\.__APOLLO_STATE__\s*=\s*({[\s\S]+?});?\s*$/m)
        if (match) {
          try {
            return { source: 'script_APOLLO', data: JSON.parse(match[1]) }
          } catch (e) {
            // ignore
          }
        }
        // 匹配 __DATA__
        match = text.match(/window\.__DATA__\s*=\s*({[\s\S]+?});?\s*$/m)
        if (match) {
          try {
            return { source: 'script_DATA', data: JSON.parse(match[1]) }
          } catch (e) {
            // ignore
          }
        }
      }
      return null
    })
    


    // 优先使用 API 数据，其次是 SSR 数据
    let detailData = videoData?.data?.visionVideoDetail?.photo ||
                     videoData?.data?.videoDetail?.photo ||
                     videoData?.data?.photo ||
                     videoData?.data?.visionVideoDetail ||
                     videoData?.data?.videoDetail
    
    // 处理 visionShortVideoReco.feeds 数据结构（快手推荐视频）
    if (!detailData && videoData?.data?.visionShortVideoReco?.feeds) {
      const feeds = videoData.data.visionShortVideoReco.feeds
      
      // 尝试从多个 URL 格式中提取视频 ID
      const possibleUrls = [finalUrl, url, page.url()]
      let targetVideoId: string | null = null
      
      for (const checkUrl of possibleUrls) {
        // 尝试 /short-video/xxx 格式
        const shortMatch = checkUrl.match(/\/short-video\/([^?&#/]+)/)
        if (shortMatch) {
          targetVideoId = shortMatch[1]
          break
        }
        // 尝试 shareToken=xxx 格式
        const shareMatch = checkUrl.match(/shareToken=([^&#]+)/)
        if (shareMatch) {
          targetVideoId = shareMatch[1]
          break
        }
        // 尝试 shareId=xxx 格式
        const shareIdMatch = checkUrl.match(/shareId=([^&#]+)/)
        if (shareIdMatch) {
          targetVideoId = shareIdMatch[1]
          break
        }
        // 尝试 objectId=xxx 格式
        const objectIdMatch = checkUrl.match(/objectId=([^&#]+)/)
        if (objectIdMatch) {
          targetVideoId = objectIdMatch[1]
          break
        }
      }
      
      // 查找当前 URL 对应的视频
      let found = false
      for (const feed of feeds) {
        const feedPhotoId = feed.photo?.id
        // 检查多种匹配方式
        const isMatch = feedPhotoId === targetVideoId ||
                       (targetVideoId && feed.photo?.caption?.includes(targetVideoId)) ||
                       (targetVideoId && feed.photo?.originCaption?.includes(targetVideoId))
        if (isMatch) {
          detailData = feed.photo
          found = true
          break
        }
      }
      
      // 如果没找到匹配的，尝试通过其他方式匹配
      if (!found) {
        
        // 从 URL 中提取 objectId 和 authorId
        const objectIdMatch = finalUrl.match(/shareObjectId=([^&#]+)/) || 
                             url.match(/shareObjectId=([^&#]+)/) ||
                             page.url().match(/shareObjectId=([^&#]+)/)
        const objectId = objectIdMatch ? objectIdMatch[1] : null
        
        const authorIdMatch = finalUrl.match(/authorId=([^&#]+)/) ||
                             url.match(/authorId=([^&#]+)/) ||
                             page.url().match(/authorId=([^&#]+)/)
        const authorId = authorIdMatch ? authorIdMatch[1] : null

        
        // 如果有 authorId，尝试使用作者主页 API 获取视频列表
        if (authorId && objectId) {
          try {

            const recoQuery = {
              operationName: 'visionNewRecoFeed',
              variables: { photoId: objectId, authorId: authorId },
              query: `query visionNewRecoFeed($photoId: String!, $authorId: String!) {
                visionNewRecoFeed(photoId: $photoId, authorId: $authorId) {
                  feeds {
                    type
                    photo {
                      id
                      duration
                      caption
                      photoUrl
                      coverUrl
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
              }`
            }
            
            const recoResponse = await page.evaluate(async (query) => {
              const res = await fetch('https://www.kuaishou.com/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(query)
              })
              return await res.json()
            }, recoQuery)
            
            // 在推荐视频列表中查找目标视频
            if (recoResponse?.data?.visionNewRecoFeed?.feeds) {
              const recoFeeds = recoResponse.data.visionNewRecoFeed.feeds
              for (const feed of recoFeeds) {
                if (feed.photo?.id === objectId) {
                  detailData = feed.photo
                  found = true
                  break
                }
              }
            }
          } catch (e) {
          }
        }
        
        // 如果仍然没找到，尝试点击页面上匹配 objectId 的视频元素
        if (!found && objectId) {

          try {
            const clicked = await page.evaluate((targetId) => {
              // 尝试多种方式找到并点击目标视频
              const selectors = [
                `[data-video-id="${targetId}"]`,
                `[data-id="${targetId}"]`,
                `a[href*="${targetId}"]`,
                `.video-card[data-id="${targetId}"]`,
              ]
              for (const selector of selectors) {
                const el = document.querySelector(selector)
                if (el) {
                  (el as HTMLElement).click()
                  return true
                }
              }
              return false
            }, objectId)
            
            if (clicked) {

              await new Promise(resolve => setTimeout(resolve, 5000))
            }
          } catch (e) {
  
          }
        }
        
        // 尝试从 DOM 中获取当前播放的视频信息
        if (!found) {

          const domVideoInfo = await page.evaluate(() => {
            const video = document.querySelector('video')
            if (video) {
              const sources: string[] = []
              video.querySelectorAll('source').forEach((source: any) => {
                if (source.src) sources.push(source.src)
              })
              return {
                src: video.src || sources[0] || '',
                duration: video.duration,
                currentSrc: video.currentSrc
              }
            }
            return null
          })

          
          // 如果 DOM 中有视频信息，尝试匹配
          if (domVideoInfo?.src) {
            for (const feed of feeds) {
              if (feed.photo?.photoUrl?.includes(domVideoInfo.src) || 
                  domVideoInfo.src?.includes(feed.photo?.id || '')) {

                detailData = feed.photo
                found = true
                break
              }
            }
          }
        }
      }
    }
    
    // 如果 detailData 没有有效的视频 URL，再尝试从 renderData 获取
    const hasValidVideoUrl = detailData?.photoUrl || detailData?.manifest || detailData?.mvUrls
    if (!hasValidVideoUrl) {
      
      // 尝试遍历 defaultClient 的所有键查找视频数据
      if (renderData?.data?.defaultClient) {
        const client = renderData.data.defaultClient
        for (const key of Object.keys(client)) {
          const item = client[key]
          // 查找包含 manifest、mvUrls、photoUrl 等视频相关字段的对象
          if (item && (item.manifest || item.mvUrls || item.mainMvUrls || item.photoUrl || item.url || item.playUrl)) {

            detailData = item
            break
          }
        }
      }
      
      // 如果仍然没有有效的视频URL，使用第一个 feed
      const stillHasValidUrl = detailData?.photoUrl || detailData?.manifest || detailData?.mvUrls
      if (!stillHasValidUrl && videoData?.data?.visionShortVideoReco?.feeds) {

        detailData = videoData.data.visionShortVideoReco.feeds[0]?.photo
      }
    }
    


    if (detailData) {
      const photo = detailData

      // 构建格式列表
      const formats: any[] = []

      // 从 APOLLO client 中获取真正的 manifest 数据（manifest 可能是引用）
      let manifestData = photo.manifest
      if (photo.manifest?.id && renderData?.data?.defaultClient?.[photo.manifest.id]) {
        manifestData = renderData.data.defaultClient[photo.manifest.id]
      }

      // adaptationSet 可能是引用，需要获取真正的数据
      let adaptationSet = manifestData?.adaptationSet
      if (Array.isArray(adaptationSet) && adaptationSet[0]?.id) {
        const adaptationSetId = adaptationSet[0].id
        if (renderData?.data?.defaultClient?.[adaptationSetId]) {
          adaptationSet = renderData.data.defaultClient[adaptationSetId]
        }
      }

      // 处理不同清晰度的视频 (manifest 格式)
      if (adaptationSet?.representation) {
        let representations = adaptationSet.representation
        // representation 可能是引用数组，需要获取真正的数据
        if (Array.isArray(representations) && representations[0]?.type === 'id') {
          representations = representations.map((ref: any) => {
            if (ref?.id && renderData?.data?.defaultClient?.[ref.id]) {
              return renderData.data.defaultClient[ref.id]
            }
            return ref
          })
        }
        representations.forEach((rep: any, index: number) => {
          if (rep.url) {
            // 估算文件大小：使用平均码率 * 时长 / 8
            // 如果 avgBitrate 是 bps，duration 是毫秒
            let filesize = rep.size || rep.fileSize || 0
            
            if (!filesize && photo.duration) {
              if (rep.avgBitrate) {
                // avgBitrate (bps) * duration (ms) / 1000 (to seconds) / 8 (to bytes)
                filesize = Math.floor((rep.avgBitrate * photo.duration) / 1000 / 8)
              } else {
                // 没有码率信息时，根据清晰度估算
                const durationSec = photo.duration / 1000
                const height = rep.height || 720
                let estimatedBitrate = 2000000 // 默认 2Mbps
                if (height >= 1080) estimatedBitrate = 5000000
                else if (height >= 720) estimatedBitrate = 2500000
                else if (height >= 480) estimatedBitrate = 1500000
                else if (height >= 360) estimatedBitrate = 800000
                filesize = Math.floor((estimatedBitrate * durationSec) / 8)
              }
            }
            
            formats.push({
              formatId: `ks_${index}`,
              quality: `${rep.height}p`,
              ext: 'mp4',
              filesize: filesize,
              width: rep.width || 0,
              height: rep.height || 0,
              fps: rep.frameRate || 30,
              hasAudio: true,
              url: rep.url
            })
          }
        })
      }

      // 处理 mvUrls (快手常用格式，包含多个清晰度)
      if (photo.mvUrls && Array.isArray(photo.mvUrls)) {
        photo.mvUrls.forEach((mv: any, index: number) => {
          if (mv.url) {
            let filesize = mv.size || 0
            
            // 如果没有文件大小，使用码率和时长估算
            if (!filesize && photo.duration) {
              const durationSec = photo.duration / 1000
              const height = mv.height || 720
              let estimatedBitrate = 2000000
              if (height >= 1080) estimatedBitrate = 5000000
              else if (height >= 720) estimatedBitrate = 2500000
              else if (height >= 480) estimatedBitrate = 1500000
              else if (height >= 360) estimatedBitrate = 800000
              filesize = Math.floor((estimatedBitrate * durationSec) / 8)
            }
            
            formats.push({
              formatId: `ks_mv_${index}`,
              quality: mv.quality || '默认',
              ext: 'mp4',
              filesize: filesize,
              width: mv.width || 0,
              height: mv.height || 0,
              fps: 30,
              hasAudio: true,
              url: mv.url
            })
          }
        })
      }

      // 处理 mainMvUrls
      if (formats.length === 0 && photo.mainMvUrls?.[0]?.url) {
        let filesize = photo.mainMvUrls[0].size || photo.size || 0
        
        // 如果没有文件大小，使用码率和时长估算
        if (!filesize && photo.duration) {
          const durationSec = photo.duration / 1000
          const height = photo.mainMvUrls[0].height || photo.height || 720
          let estimatedBitrate = 2000000
          if (height >= 1080) estimatedBitrate = 5000000
          else if (height >= 720) estimatedBitrate = 2500000
          else if (height >= 480) estimatedBitrate = 1500000
          else if (height >= 360) estimatedBitrate = 800000
          filesize = Math.floor((estimatedBitrate * durationSec) / 8)
        }
        
        formats.push({
          formatId: 'default',
          quality: '默认',
          ext: 'mp4',
          filesize: filesize,
          width: photo.mainMvUrls[0].width || photo.width || 0,
          height: photo.mainMvUrls[0].height || photo.height || 0,
          fps: 30,
          hasAudio: true,
          url: photo.mainMvUrls[0].url
        })
      }

      // 备用：使用 photoUrl
      if (formats.length === 0 && photo.photoUrl) {
        let filesize = photo.size || 0
        
        // 如果没有文件大小，使用码率和时长估算
        if (!filesize && photo.duration) {
          const durationSec = photo.duration / 1000
          const height = photo.height || 720
          let estimatedBitrate = 2000000
          if (height >= 1080) estimatedBitrate = 5000000
          else if (height >= 720) estimatedBitrate = 2500000
          else if (height >= 480) estimatedBitrate = 1500000
          else if (height >= 360) estimatedBitrate = 800000
          filesize = Math.floor((estimatedBitrate * durationSec) / 8)
        }
        
        formats.push({
          formatId: 'default',
          quality: '默认',
          ext: 'mp4',
          filesize: filesize,
          width: photo.width || 0,
          height: photo.height || 0,
          fps: 30,
          hasAudio: true,
          url: photo.photoUrl
        })
      }

      // 备用：使用任何包含 url 的字段
      if (formats.length === 0 && photo.url) {
        let filesize = photo.size || 0
        
        // 如果没有文件大小，使用码率和时长估算
        if (!filesize && photo.duration) {
          const durationSec = photo.duration / 1000
          const height = photo.height || 720
          let estimatedBitrate = 2000000
          if (height >= 1080) estimatedBitrate = 5000000
          else if (height >= 720) estimatedBitrate = 2500000
          else if (height >= 480) estimatedBitrate = 1500000
          else if (height >= 360) estimatedBitrate = 800000
          filesize = Math.floor((estimatedBitrate * durationSec) / 8)
        }
        
        formats.push({
          formatId: 'default',
          quality: '默认',
          ext: 'mp4',
          filesize: filesize,
          width: photo.width || 0,
          height: photo.height || 0,
          fps: 30,
          hasAudio: true,
          url: photo.url
        })
      }

      // 按高度降序排序
      formats.sort((a, b) => (b.height || 0) - (a.height || 0))

      // 验证视频 ID 是否匹配目标视频
      const targetVideoId = videoId || (finalUrl.match(/\/short-video\/([^?&#]+)/) || url.match(/\/short-video\/([^?&#]+)/) || [])[1]
      const returnedVideoId = photo.photoId || photo.id
      if (targetVideoId && returnedVideoId && targetVideoId !== returnedVideoId) {

        throw new Error(`视频 ID 不匹配: 目标视频 ${targetVideoId}，返回视频 ${returnedVideoId}`)
      }

      videoInfo = {
        id: photo.photoId || photo.id || Date.now().toString(),
        title: photo.caption || '快手视频',
        description: photo.caption,
        thumbnail: photo.coverUrls?.[0]?.url || photo.coverUrl || '',
        duration: photo.duration ? Math.floor(photo.duration / 1000) : 0,
        uploader: photo.userName || photo.authorName || '',
        webpageUrl: finalUrl,
        formats: formats
      }
    } else {
      // 如果 API 失败，尝试从页面 DOM 提取

      
      // 尝试触发视频加载 - 滚动和交互
      await page.evaluate(async () => {
        // 滚动到页面底部再回来
        window.scrollTo(0, document.body.scrollHeight)
        await new Promise(r => setTimeout(r, 1000))
        window.scrollTo(0, 0)
        await new Promise(r => setTimeout(r, 1000))
        
        // 尝试点击视频区域
        const videoContainer = document.querySelector('.video-container') || 
                             document.querySelector('[class*="video"]') ||
                             document.querySelector('video')
        if (videoContainer) {
          ;(videoContainer as HTMLElement).click()
          await new Promise(r => setTimeout(r, 2000))
        }
      })
      
      // 再等待一下让视频加载
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      // 先检查页面是否有 video 元素
      const hasVideo = await page.evaluate(() => {
        const videoEl = document.querySelector('video')
        // 尝试所有可能的视频相关属性
        const possibleSources = [
          videoEl?.src,
          videoEl?.currentSrc,
          videoEl?.querySelector('source')?.src,
          (videoEl as any)?.dataset?.src,
          (videoEl as any)?.dataset?.videoSrc,
          (videoEl as any)?.dataset?.url,
          (videoEl as any)?.props?.src,
          (videoEl as any)?.props?.url,
        ]
        return {
          hasVideo: !!videoEl,
          videoSrc: videoEl?.src || '',
          currentSrc: videoEl?.currentSrc || '',
          sourceSrc: videoEl?.querySelector('source')?.src || '',
          dataSrc: (videoEl as any)?.dataset?.src || '',
          allSources: possibleSources.filter(s => s),
          allVideos: Array.from(document.querySelectorAll('video')).map(v => ({
            src: v.src,
            currentSrc: v.currentSrc,
            dataSrc: (v as any).dataset?.src,
            duration: v.duration
          }))
        }
      })

      
      videoInfo = await page.evaluate(() => {
        // 尝试多种选择器
        const titleEl = document.querySelector('.video-title') ||
                        document.querySelector('[data-e2e="video-title"]') ||
                        document.querySelector('[class*="title"]') ||
                        document.querySelector('.caption') ||
                        document.querySelector('.video-info-title') ||
                        document.querySelector('h1') ||
                        document.querySelector('[class*="desc"]')
        const authorEl = document.querySelector('.user-name') ||
                         document.querySelector('[data-e2e="user-name"]') ||
                         document.querySelector('[class*="author"]') ||
                         document.querySelector('.author-name') ||
                         document.querySelector('.video-info-user-name')
        
        // 查找视频元素
        const videoEl = document.querySelector('video') as HTMLVideoElement
        
        // 尝试多种方式获取视频 URL
        let videoSrc: string | undefined = videoEl?.src
        if (!videoSrc) videoSrc = videoEl?.currentSrc
        if (!videoSrc) videoSrc = videoEl?.querySelector('source')?.src
        if (!videoSrc) videoSrc = (videoEl as any)?.dataset?.src
        if (!videoSrc) videoSrc = (videoEl as any)?.dataset?.videoSrc
        if (!videoSrc) videoSrc = (videoEl as any)?.dataset?.url
        if (!videoSrc) videoSrc = (videoEl as any)?.props?.src
        if (!videoSrc) videoSrc = (videoEl as any)?.props?.url
        
        // 尝试从 img 标签的 src 获取缩略图
        let thumbnail = ''
        const imgEl = document.querySelector('[class*="cover"] img') || 
                    document.querySelector('[class*="thumbnail"] img') ||
                    document.querySelector('video')?.poster
        if (imgEl) {
          thumbnail = (imgEl as HTMLImageElement).src || imgEl.getAttribute('data-src') || ''
        }
        
        return {
          id: Date.now().toString(),
          title: titleEl?.textContent?.trim() || '快手视频',
          description: titleEl?.textContent?.trim() || '',
          thumbnail: thumbnail,
          duration: videoEl?.duration || 0,
          uploader: authorEl?.textContent?.trim() || '',
          webpageUrl: window.location.href,
          formats: videoSrc ? [{
            formatId: 'default',
            quality: '默认',
            ext: 'mp4',
            filesize: 0,
            width: 0,
            height: 0,
            fps: 30,
            hasAudio: true,
            url: videoSrc
          }] : []
        }
      })
      

    }

    if (!videoInfo || videoInfo.formats.length === 0) {
      throw new Error('无法获取视频信息，请检查链接是否有效')
    }

    return videoInfo
  } finally {
    await browser.close()
  }
}

// 解析视频信息
ipcMain.handle('ytdlp:parse', async (_event, ...args) => {
  const url = args[0] as string
  const cookiesFile = args[1] as string | undefined
  // 如果是抖音链接，优先使用 API 解析
  if (isDouyinUrl(url)) {
    try {
      return await parseDouyinWithAPI(url)
    } catch (e: any) {
      try {
        return await parseDouyinWithPuppeteer(url)
      } catch (e2: any) {
      }
    }
  }
  // 如果是快手链接，使用 Puppeteer 解析
  if (isKuaishouUrl(url)) {
    try {
      const result = await parseKuaishouWithAPI(url)
      return result
    } catch (e: any) {
      try {
        const result = await parseKuaishouWithPuppeteer(url)
        return result
      } catch (e2: any) {
      }
    }
  }
  
  return new Promise(async (resolve, reject) => {
    const ytdlpPath = getYtDlpPath()
    const isYoutube = url.includes('youtube.com') || url.includes('youtu.be')
    
    const args: string[] = [
      '--dump-json',
      '--no-playlist',
      '--no-check-certificates',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    ]
    
    // YouTube 需要 JS 运行时（优先使用 Node.js）
    if (isYoutube) {
      const runtimePath = getJsRuntimePath()
      if (runtimePath) {
        // 根据路径判断是 Node.js 还是 Deno
        const isNode = runtimePath.includes('node')
        const runtimeName = isNode ? 'node' : 'deno'
        args.push('--js-runtimes', `${runtimeName}:${runtimePath}`)
      }
      
      // YouTube 可能需要 cookies 来绕过登录验证
      // 优先使用用户提供的 cookies 文件
      if (cookiesFile && fs.existsSync(cookiesFile)) {
        args.push('--cookies', cookiesFile)
      }
    }
    
    args.push(url)
    
    // 设置工作目录为 yt-dlp 所在目录，确保能找到 deno.exe
    const cwd = path.dirname(ytdlpPath)
    const child = spawn(ytdlpPath, args, { cwd })
    let output = ''
    let errorOutput = ''
    
    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString()
    })
    
    child.stderr?.on('data', (data: Buffer) => {
      errorOutput += data.toString()
    })
    
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(errorOutput || '解析失败'))
        return
      }
      
      try {
        const info = JSON.parse(output)

        // 返回所有视频格式（B站/Instagram可能音视频分离，yt-dlp会自动合并）
        let formats = info.formats
          ?.filter((f: any) => {
            // 只要有视频就可以（音频可以单独下载后合并）
            const hasVideo = f.vcodec !== 'none' && f.vcodec !== null && f.vcodec !== undefined && f.vcodec !== ''
            // 接受所有常见视频格式
            const isVideoFormat = f.height && f.height > 0
            return hasVideo && isVideoFormat
          })
          ?.map((f: any) => {
            // 获取文件大小：优先使用 filesize，其次是 filesize_approx
            // 对于 YouTube，还可以尝试通过码率和时长估算
            let filesize = f.filesize || f.filesize_approx || 0
            
            // 如果没有文件大小但有码率和视频时长，进行估算
            if (!filesize && f.tbr && info.duration) {
              // tbr (kbps) * duration (seconds) / 8 = bytes
              filesize = Math.floor((f.tbr * 1000 * info.duration) / 8)
            }
            
            return {
              formatId: f.format_id,
              quality: f.quality_label || f.resolution || f.format_note || `${f.height}p`,
              ext: f.ext || f.video_ext || 'mp4',
              filesize: filesize,
              width: f.width,
              height: f.height,
              fps: f.fps,
              hasAudio: f.acodec && f.acodec !== 'none',
            }
          })
          ?.filter((f: any) => f.quality && f.quality !== 'undefinedp')
          // 添加码率信息用于排序和去重
          ?.map((f: any) => ({
            ...f,
            // 使用原始格式数据中的码率信息
            _tbr: info.formats?.find((orig: any) => orig.format_id === f.formatId)?.tbr || 0,
            _vbr: info.formats?.find((orig: any) => orig.format_id === f.formatId)?.vbr || 0,
          }))
          // 先按分辨率排序，再按码率排序，优先选择包含音频的格式
          ?.sort((a: any, b: any) => {
            const heightDiff = (b.height || 0) - (a.height || 0)
            if (heightDiff !== 0) return heightDiff
            // 相同分辨率优先选择包含音频的
            if (a.hasAudio && !b.hasAudio) return -1
            if (!a.hasAudio && b.hasAudio) return 1
            // 都包含音频或都不包含，按码率排序
            return (b._tbr || b._vbr || 0) - (a._tbr || a._vbr || 0)
          })
          // 去重：相同分辨率只保留码率最高的
          ?.filter((f: any, index: number, self: any[]) => {
            const firstIndex = self.findIndex((t: any) => t.quality === f.quality)
            if (index === firstIndex) return true
            // 如果已经有相同分辨率的，保留码率更高的
            const existing = self[firstIndex]
            const fBitrate = f._tbr || f._vbr || 0
            const eBitrate = existing._tbr || existing._vbr || 0
            if (fBitrate > eBitrate) {
              // 替换掉已存在的
              self[firstIndex] = { ...existing, _remove: true }
              return true
            }
            return false
          })
          ?.filter((f: any) => !f._remove)
          // 清理临时字段
          ?.map((f: any) => {
            const { _tbr, _vbr, _remove, ...rest } = f
            return rest
          })
        
        resolve({
          id: info.id,
          title: info.title,
          description: info.description,
          thumbnail: info.thumbnail,
          duration: info.duration,
          uploader: info.uploader,
          webpageUrl: info.webpage_url,
          formats: formats || [],
        })
      } catch (e) {
        reject(new Error('解析响应失败'))
      }
    })
  })
})

// 直接下载文件（用于抖音等直接URL）
async function downloadDirectFile(url: string, outputPath: string, taskId: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.douyin.com/'
        }
      })

      if (!response.ok) {
        reject(new Error(`HTTP ${response.status}: ${response.statusText}`))
        return
      }

      const totalSize = parseInt(response.headers.get('content-length') || '0')
      const writer = fs.createWriteStream(outputPath)

      let downloaded = 0
      let lastProgressUpdate = 0
      const reader = response.body?.getReader()

      if (!reader) {
        reject(new Error('无法读取响应流'))
        return
      }

      // 发送开始下载事件
      sendDownloadProgress({
        taskId: taskId,
        url: url,
        percent: 0,
        status: 'downloading',
        speed: '0 MB/s',
        eta: '计算中...'
      })

      const startTime = Date.now()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          writer.write(Buffer.from(value))
          downloaded += value.length

          // 计算进度 - 每下载 100KB 或每 500ms 更新一次
          const now = Date.now()
          if (totalSize > 0 && (downloaded - lastProgressUpdate > 102400 || now - startTime > 500)) {
            lastProgressUpdate = downloaded
            const percent = (downloaded / totalSize) * 100
            const elapsed = (now - startTime) / 1000
            const speed = elapsed > 0 ? (downloaded / 1024 / 1024 / elapsed).toFixed(2) : '0'
            const remaining = downloaded > 0 ? (totalSize - downloaded) / (downloaded / elapsed) : 0
            const eta = Math.ceil(remaining)

            sendDownloadProgress({
              taskId: taskId,
              url: url,
              percent: percent,
              status: 'downloading',
              totalSize: `${(totalSize / 1024 / 1024).toFixed(1)} MB`,
              speed: `${speed} MB/s`,
              eta: `${eta}s`
            })
          }
        }

        // 关闭写入流
        writer.end()

        // 等待写入完成
        await new Promise((resolveWriter, rejectWriter) => {
          writer.on('finish', () => {
            sendDownloadProgress({
              taskId: taskId,
              url: url,
              percent: 100,
              status: 'completed'
            })
            resolveWriter(undefined)
          })

          writer.on('error', (err) => {
            rejectWriter(err)
          })
        })

        resolve()
      } catch (readError) {
        writer.destroy()
        reject(readError)
      }
    } catch (e) {
      reject(e)
    }
  })
}

// 下载视频（使用最佳格式，自动合并音视频）
ipcMain.handle('ytdlp:download', async (_event, options: {
  url: string
  formatId: string
  outputDir: string
  filename?: string
  taskId: string
  directUrl?: string
  cookiesFile?: string
}) => {
  return new Promise(async (resolve, reject) => {
    const outputDir = ensureDownloadDir(options.outputDir)
    
    // 如果有直接下载链接（抖音），使用直接下载
    if (options.directUrl) {
      const filename = options.filename || `video_${Date.now()}.mp4`
      const outputPath = path.join(outputDir, filename)

      try {
        await downloadDirectFile(options.directUrl, outputPath, options.taskId)
        resolve({ filePath: outputPath })
        return
      } catch (e: any) {
        // 如果直接下载失败，回退到 yt-dlp
      }
    }
    
    const ytdlpPath = getYtDlpPath()
    const isYoutube = options.url.includes('youtube.com') || options.url.includes('youtu.be')
    
    // 使用固定文件名避免编码问题
    const safeFilename = `video_${Date.now()}`
    const outputTemplate = path.join(outputDir, `${safeFilename}.%(ext)s`)

    // 根据平台选择格式策略
    // Instagram的音视频通常是分离的，需要下载后合并
    // B站/YouTube等平台也可能需要单独下载视频和音频后合并
    const formatSelector = `${options.formatId}+bestaudio[ext=m4a]/bestaudio/best`

    // 使用最佳视频+最佳音频，自动合并
    const args: string[] = [
      '-f', formatSelector,
      '-o', outputTemplate,
      '--newline',
      '--no-playlist',
      '--no-continue',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', getFfmpegPath(),
      '--postprocessor-args', 'FFmpegMetadata:-write_id3v1 1',
      '--encoding', 'utf-8',
    ]
    
    // YouTube 需要 JS 运行时（优先使用 Node.js）
    if (isYoutube) {
      const runtimePath = getJsRuntimePath()
      if (runtimePath) {
        // 根据路径判断是 Node.js 还是 Deno
        const isNode = runtimePath.includes('node')
        const runtimeName = isNode ? 'node' : 'deno'
        args.push('--js-runtimes', `${runtimeName}:${runtimePath}`)
      }
      
      // YouTube 可能需要 cookies 来绕过登录验证
      // 优先使用用户提供的 cookies 文件
      if (options.cookiesFile && fs.existsSync(options.cookiesFile)) {
        args.push('--cookies', options.cookiesFile)
      }
    }
    
    args.push(options.url)
    
    // 设置工作目录为 yt-dlp 所在目录，确保能找到 deno.exe
    const cwd = path.dirname(ytdlpPath)
    const child = spawn(ytdlpPath, args, { cwd })
    let downloadedFile = ''
    let lastProgress = 0
    let hasStarted = false
    
    // 立即发送开始下载事件
    sendDownloadProgress({
      taskId: options.taskId,
      url: options.url,
      percent: 0,
      status: 'downloading',
      speed: '0 MiB/s',
      eta: '00:00'
    })
    
    child.stdout.on('data', (data) => {
      const line = data.toString()
      
      // 解析进度 - 匹配多种格式
      const progressPatterns = [
        // YouTube 格式: [download]  22.5% of ~ 304.50MiB at    1.38MiB/s ETA 02:45 (frag 55/249)
        /\[download\]\s+(\d+\.?\d*)%\s+of\s+~?\s*(\d+\.?\d*\w?)\s+at\s+([\d.]+\w?\/s)\s+ETA\s+(\d+:\d+)/,
        // 其他格式
        /\[download\]\s+(\d+\.?\d*)%\s+of\s+(\d+\.?\d*\w?)\s+at\s+([\d.]+\w?\/s)\s+ETA\s+(\d+:\d+)/,
        // 简单百分比
        /\[download\]\s+(\d+\.?\d*)%/,
      ]
      
      for (const pattern of progressPatterns) {
        const match = line.match(pattern)
        if (match) {
          const percent = parseFloat(match[1])
          // 允许进度更新（YouTube 进度可能会波动）
          if (Math.abs(percent - lastProgress) > 0.1 || !hasStarted) {
            lastProgress = percent
            hasStarted = true
            sendDownloadProgress({
              taskId: options.taskId,
              url: options.url,
              percent: percent,
              totalSize: match[2] || '',
              speed: match[3] || '',
              eta: match[4] || '',
              status: 'downloading'
            })
          }
          break
        }
      }
      
      // 获取下载完成的文件路径
      const destMatch = line.match(/\[download\] Destination: (.+)/)
      if (destMatch) {
        const rawPath = destMatch[1].trim()
        // 转换为绝对路径并规范化
        downloadedFile = path.resolve(rawPath.replace(/\//g, '\\'))
      }
      
      // 已存在文件
      const existsMatch = line.match(/\[download\] (.+) has already been downloaded/)
      if (existsMatch) {
        const rawPath = existsMatch[1].trim()
        downloadedFile = path.resolve(rawPath.replace(/\//g, '\\'))
      }
      
      // FFmpeg 合并中
      if (line.includes('[Merger]') || line.includes('Merging formats')) {
        sendDownloadProgress({
          taskId: options.taskId,
          url: options.url,
          percent: 99,
          status: 'merging',
          message: '正在合并音视频...'
        })
      }
      
      // 获取合并后的文件路径（Merger 输出了合并后的文件）
      const mergeMatch = line.match(/\[Merger\] Merging formats into "(.+)"/)
      if (mergeMatch) {
        const rawPath = mergeMatch[1].trim()
        downloadedFile = path.resolve(rawPath.replace(/\//g, '\\'))
      }
    })
    
    child.stderr.on('data', (data) => {
      const line = data.toString()
      
      // 某些进度信息在 stderr 中
      const percentMatch = line.match(/(\d+\.?\d*)%/)
      if (percentMatch) {
        const percent = parseFloat(percentMatch[1])
        if (percent > lastProgress || !hasStarted) {
          lastProgress = percent
          hasStarted = true
          sendDownloadProgress({
            taskId: options.taskId,
            url: options.url,
            percent: percent,
            status: 'downloading'
          })
        }
      }
    })
    
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('下载失败'))
        return
      }
      
      // 如果没有获取到合并后的路径，手动构造 mp4 路径
      if (downloadedFile && downloadedFile.endsWith('.m4a')) {
        downloadedFile = downloadedFile.replace(/\.m4a$/, '.mp4')
      }
      
      // 清理临时文件
      if (downloadedFile) {
        const basePath = downloadedFile.replace(/\.[^.]+$/, '')
        const tempFiles = [
          `${basePath}.part`,
          `${basePath}.part-Frag*`,
          `${basePath}.ytdl`,
          `${basePath}.f*.part`,
          `${basePath}.f*.ytdl`,
        ]
        
        for (const pattern of tempFiles) {
          try {
            // 处理通配符
            if (pattern.includes('*')) {
              const dir = path.dirname(pattern)
              const baseName = path.basename(pattern).replace(/\*/g, '.*')
              const regex = new RegExp(baseName.replace(/\./g, '\\.'))
              
              if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir)
                for (const file of files) {
                  if (regex.test(file)) {
                    const fullPath = path.join(dir, file)
                    fs.unlinkSync(fullPath)
                  }
                }
              }
            } else if (fs.existsSync(pattern)) {
              fs.unlinkSync(pattern)
            }
          } catch (e) {
            // 忽略清理错误
          }
        }
      }
      
      // 发送完成事件
      sendDownloadProgress({
        taskId: options.taskId,
        url: options.url,
        percent: 100,
        status: 'completed'
      })
      
      resolve({
        success: true,
        filePath: downloadedFile,
      })
    })
    
    child.on('error', (err) => {
      reject(err)
    })
  })
})

// 获取下载历史
const historyFile = path.join(app.getPath('userData'), 'download-history.json')

ipcMain.handle('history:get', async () => {
  try {
    if (fs.existsSync(historyFile)) {
      const data = fs.readFileSync(historyFile, 'utf8')
      return JSON.parse(data)
    }
    return []
  } catch (e) {
    return []
  }
})

ipcMain.handle('history:add', async (_, record: any) => {
  try {
    let history = []
    if (fs.existsSync(historyFile)) {
      const data = fs.readFileSync(historyFile, 'utf8')
      history = JSON.parse(data)
    }
    history.unshift({
      ...record,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    })
    // 只保留最近 100 条
    history = history.slice(0, 100)
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2))
    return true
  } catch (e) {
    return false
  }
})

ipcMain.handle('history:delete', async (_, id: string) => {
  try {
    if (fs.existsSync(historyFile)) {
      const data = fs.readFileSync(historyFile, 'utf8')
      let history = JSON.parse(data)
      history = history.filter((h: any) => h.id !== id)
      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2))
    }
    return true
  } catch (e) {
    return false
  }
})

// 获取带 referer 的图片（用于B站等需要referer的图片）
ipcMain.handle('app:fetchImage', async (_, url: string, referer: string) => {
  try {
    const response = await fetch(url, {
      headers: {
        'Referer': referer || 'https://www.bilibili.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    return `data:${contentType};base64,${base64}`
  } catch (e) {
    return null
  }
})
