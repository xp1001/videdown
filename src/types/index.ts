export interface VideoFormat {
  formatId: string
  quality: string
  ext: string
  filesize?: number
  width?: number
  height?: number
  fps?: number
  hasAudio?: boolean
  url?: string
}

export interface AudioFormat {
  formatId: string
  quality: string
  ext: string
  filesize?: number
  url?: string
}

export interface AudioTrack {
  id: string
  name: string
  language: string
}

export interface SubtitleInfo {
  language: string
  name: string
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
  isYoutube?: boolean
  audioFormats?: AudioFormat[]
  audioTracks?: AudioTrack[]
  subtitles?: SubtitleInfo[]
}

export interface DownloadTask {
  id: string
  url: string
  videoInfo: VideoInfo
  selectedFormat: VideoFormat
  outputDir: string
  status: 'pending' | 'downloading' | 'merging' | 'completed' | 'error' | 'paused'
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
