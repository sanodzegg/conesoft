import type { ConversionEngine } from './ConversionEngine'
import type { ConversionOptions } from '@/types'
import { getExtension } from '@/utils/fileUtils'

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
    const buffer = await file.arrayBuffer()
    const result = await window.electron.convertVideo(buffer, sourceExt, targetFormat, {
      width: options.width,
      height: options.height,
      fit: options.fit,
    })
    return new Blob([result], { type: MIME[targetFormat] })
  },
}
