export interface VideoFormat {
  formatId: string
  quality: string
  ext: string
  filesize?: number
  width?: number
  height?: number
  fps?: number
  hasAudio?: boolean
  url?: string  // 直接下载链接（用于抖音等平台）
}

export interface VideoInfo {
  id: string
  title: string
  description?: string
  thumbnail: string
  duration?: number
  uploader?: string
  webpageUrl: string
  formats: VideoFormat[]
}

export interface DownloadTask {
  id: string
  url: string
  videoInfo: VideoInfo
  selectedFormat: VideoFormat
  outputDir: string
  status: 'pending' | 'downloading' | 'merging' | 'completed' | 'error'
  progress: number
  downloadedSize?: string
  totalSize?: string
  speed?: string
  eta?: string
  error?: string
  filePath?: string
  statusMessage?: string
  createdAt: string
}

export interface HistoryRecord {
  id: string
  title: string
  thumbnail: string
  url: string
  filePath: string
  format: string
  quality: string
  fileSize?: string
  createdAt: string
}

export type TabType = 'download' | 'history' | 'about' | 'settings'
