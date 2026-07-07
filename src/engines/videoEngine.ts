import type { ConversionEngine } from './ConversionEngine'
import type { ConversionOptions } from '@/types'
import { getExtension, fileKey } from '@/utils/fileUtils'

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  gif: 'image/gif',
}

export const videoEngine: ConversionEngine = {
  id: 'video',
  name: 'FFmpeg Video Engine',
  supportedInputExtensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  outputFormats: ['mp4', 'webm', 'gif'],

  async convert(file: File, targetFormat: string, options: ConversionOptions): Promise<Blob> {
    const sourceExt = getExtension(file)
    // Prefer the on-disk path so ffmpeg reads the file directly - streaming a multi-GB
    // video through arrayBuffer()+IPC would OOM. Fall back to a buffer for in-memory Files.
    const path = window.electron.getPathForFile(file)
    const source = path || (await file.arrayBuffer())
    const result = await window.electron.convertVideo(source, sourceExt, targetFormat, {
      width: options.width,
      height: options.height,
      fit: options.fit,
    }, fileKey(file))
    if (!result) throw new Error('canceled') // handler returns null when the user cancelled
    return new Blob([result], { type: MIME[targetFormat] })
  },
}
