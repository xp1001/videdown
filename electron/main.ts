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

// 使用无头浏览器解析抖音视频
async function parseDouyinWithPuppeteer(url: string): Promise<any> {
  // 查找 Chrome 路径
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]

  let chromePath = chromePaths.find(p => fs.existsSync(p))
  if (!chromePath) {
    throw new Error('未找到 Chrome 浏览器，请安装 Chrome')
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

    // 访问页面（短链接会重定向，需要等待跳转完成）
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })

    // 等待页面加载并提取信息（短链接需要更长时间）
    await new Promise(resolve => setTimeout(resolve, 8000))

    // 获取最终 URL（处理短链接重定向）
    finalUrl = page.url()
    console.log('快手页面加载完成，最终URL:', finalUrl)

    // 滚动页面触发视频加载
    console.log('滚动页面触发视频加载...')
    await page.evaluate(async () => {
      // 滚动到视频区域
      const videoContainer = document.querySelector('.video-container') ||
                             document.querySelector('[data-e2e="video-container"]') ||
                             document.querySelector('.short-video') ||
                             document.body
      if (videoContainer) {
        videoContainer.scrollIntoView({ behavior: 'instant', block: 'center' })
      }
      // 等待视频加载
      await new Promise(r => setTimeout(r, 3000))
      
      // 尝试点击播放按钮触发视频加载
      const playBtn = document.querySelector('.play-button') ||
                      document.querySelector('[data-e2e="play-button"]') ||
                      document.querySelector('.video-play') ||
                      document.querySelector('.player-play')
      if (playBtn) {
        ;(playBtn as HTMLElement).click()
        await new Promise(r => setTimeout(r, 2000))
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
            const filesize = br.data_size || 0
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
        qualityMap.set('default', {
          formatId: 'normal',
          quality: '默认',
          ext: 'mp4',
          filesize: playAddr.data_size || 0,
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

// 使用无头浏览器解析快手视频
async function parseKuaishouWithPuppeteer(url: string): Promise<any> {
  // 查找 Chrome 路径
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]

  let chromePath = chromePaths.find(p => fs.existsSync(p))
  if (!chromePath) {
    throw new Error('未找到 Chrome 浏览器，请安装 Chrome')
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

      // 拦截快手视频详情 API
      if (resUrl.includes('/graphql') || resUrl.includes('/rest/wd/photo/info') || resUrl.includes('/rest/wd/photo/detail')) {
        try {
          const data = await response.json()
          if (data?.data?.visionVideoDetail || data?.data?.videoDetail || data?.data?.photo) {
            videoData = data
          }
        } catch (e) {
          // 忽略非 JSON 响应
        }
      }
    })

    // 访问页面
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })

    // 等待页面加载并提取信息
    await new Promise(resolve => setTimeout(resolve, 5000))

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
                     videoData?.data?.photo

    // 从 APOLLO_STATE 中提取视频数据
    if (!detailData && renderData?.data) {
      const apolloData = renderData.data
      // 尝试从 defaultClient 中提取
      if (apolloData.defaultClient) {
        const client = apolloData.defaultClient
        // 查找 VisionVideoDetailPhoto 类型的对象
        for (const key of Object.keys(client)) {
          const item = client[key]
          if (key.startsWith('VisionVideoDetailPhoto:') || item?.__typename === 'VisionVideoDetailPhoto') {
            detailData = item
            break
          }
          // 兼容旧的查找方式
          if (item?.__typename === 'VisionVideoDetail') {
            // photo 可能是引用，需要从 client 中查找真正的数据
            const photoRef = item.photo
            // photoRef.id 可能已经是完整格式 "VisionVideoDetailPhoto:xxx"
            const photoKey = photoRef?.id?.startsWith('VisionVideoDetailPhoto:') 
              ? photoRef.id 
              : `VisionVideoDetailPhoto:${photoRef?.id}`
            if (photoRef?.id && client[photoKey]) {
              detailData = client[photoKey]
            } else {
              detailData = item.photo || item
            }
            break
          }
          if (item?.photo) {
            detailData = item.photo
            break
          }
        }
      }
      // 尝试从 clients 中提取
      if (!detailData && apolloData.clients) {
        for (const clientKey of Object.keys(apolloData.clients)) {
          const client = apolloData.clients[clientKey]
          for (const key of Object.keys(client)) {
            const item = client[key]
            if (key.startsWith('VisionVideoDetailPhoto:') || item?.__typename === 'VisionVideoDetailPhoto') {
              detailData = item
              break
            }
            if (item?.__typename === 'VisionVideoDetail' || item?.photo) {
              detailData = item.photo || item
              break
            }
          }
          if (detailData) break
        }
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
            let estimatedSize = 0
            if (rep.avgBitrate && photo.duration) {
              // avgBitrate (bps) * duration (ms) / 1000 (to seconds) / 8 (to bytes)
              estimatedSize = Math.floor((rep.avgBitrate * photo.duration) / 1000 / 8)
            }
            formats.push({
              formatId: `ks_${index}`,
              quality: `${rep.height}p`,
              ext: 'mp4',
              filesize: rep.size || rep.fileSize || estimatedSize || 0,
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
            formats.push({
              formatId: `ks_mv_${index}`,
              quality: mv.quality || '默认',
              ext: 'mp4',
              filesize: mv.size || 0,
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
        formats.push({
          formatId: 'default',
          quality: '默认',
          ext: 'mp4',
          filesize: photo.mainMvUrls[0].size || photo.size || 0,
          width: photo.mainMvUrls[0].width || photo.width || 0,
          height: photo.mainMvUrls[0].height || photo.height || 0,
          fps: 30,
          hasAudio: true,
          url: photo.mainMvUrls[0].url
        })
      }

      // 备用：使用 photoUrl
      if (formats.length === 0 && photo.photoUrl) {
        formats.push({
          formatId: 'default',
          quality: '默认',
          ext: 'mp4',
          filesize: photo.size || 0,
          width: photo.width || 0,
          height: photo.height || 0,
          fps: 30,
          hasAudio: true,
          url: photo.photoUrl
        })
      }

      // 备用：使用任何包含 url 的字段
      if (formats.length === 0 && photo.url) {
        formats.push({
          formatId: 'default',
          quality: '默认',
          ext: 'mp4',
          filesize: photo.size || 0,
          width: photo.width || 0,
          height: photo.height || 0,
          fps: 30,
          hasAudio: true,
          url: photo.url
        })
      }

      // 按高度降序排序
      formats.sort((a, b) => (b.height || 0) - (a.height || 0))

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
      console.log('API数据获取失败，尝试从DOM提取...')
      
      // 先检查页面是否有 video 元素
      const hasVideo = await page.evaluate(() => {
        const videoEl = document.querySelector('video')
        return {
          hasVideo: !!videoEl,
          videoSrc: videoEl?.src || '',
          sourceSrc: videoEl?.querySelector('source')?.src || '',
          dataSrc: (videoEl as any)?.dataset?.src || '',
          allVideos: Array.from(document.querySelectorAll('video')).map(v => ({
            src: v.src,
            dataSrc: (v as any).dataset?.src,
            currentSrc: v.currentSrc
          }))
        }
      })
      console.log('页面视频元素检查:', hasVideo)
      
      videoInfo = await page.evaluate(() => {
        const videoEl = document.querySelector('video') as HTMLVideoElement
        const titleEl = document.querySelector('.video-title') ||
                        document.querySelector('[data-e2e="video-title"]') ||
                        document.querySelector('.caption') ||
                        document.querySelector('.video-info-title') ||
                        document.querySelector('h1') ||
                        document.querySelector('.title')
        const authorEl = document.querySelector('.user-name') ||
                         document.querySelector('[data-e2e="user-name"]') ||
                         document.querySelector('.author-name') ||
                         document.querySelector('.video-info-user-name') ||
                         document.querySelector('.author')

        // 尝试获取视频 src（多种方式）
        let videoSrc: string | undefined = videoEl?.src
        if (!videoSrc) {
          const sourceEl = videoEl?.querySelector('source')
          videoSrc = sourceEl?.src
        }
        if (!videoSrc) {
          videoSrc = (videoEl as any)?.dataset?.src
        }
        if (!videoSrc) {
          videoSrc = videoEl?.currentSrc
        }
        
        // 尝试从所有 video 元素中找
        if (!videoSrc) {
          const allVideos = document.querySelectorAll('video')
          for (const v of allVideos) {
            if (v.src || (v as any).dataset?.src) {
              videoSrc = v.src || (v as any).dataset?.src
              break
            }
          }
        }

        return {
          id: Date.now().toString(),
          title: titleEl?.textContent?.trim() || '快手视频',
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
      
      console.log('DOM提取结果:', videoInfo)
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
  // 如果是抖音链接，使用 Puppeteer 解析
  if (isDouyinUrl(url)) {
    try {
      return await parseDouyinWithPuppeteer(url)
    } catch (e: any) {
      // 如果 Puppeteer 失败，回退到 yt-dlp
    }
  }
  // 如果是快手链接，使用 Puppeteer 解析
  if (isKuaishouUrl(url)) {
    try {
      console.log('检测到快手链接，使用 Puppeteer 解析:', url)
      const result = await parseKuaishouWithPuppeteer(url)
      console.log('快手解析成功:', result.id)
      return result
    } catch (e: any) {
      console.error('快手 Puppeteer 解析失败:', e.message)
      // 如果 Puppeteer 失败，抛出错误而不是回退到 yt-dlp
      throw new Error(`快手视频解析失败: ${e.message}`)
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
          ?.map((f: any) => ({
            formatId: f.format_id,
            quality: f.quality_label || f.resolution || f.format_note || `${f.height}p`,
            ext: f.ext || f.video_ext || 'mp4',
            filesize: f.filesize || f.filesize_approx,
            width: f.width,
            height: f.height,
            fps: f.fps,
            hasAudio: f.acodec && f.acodec !== 'none',
          }))
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
