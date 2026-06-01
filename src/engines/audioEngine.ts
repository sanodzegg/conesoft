import type { ConversionEngine } from './ConversionEngine'
import type { ConversionOptions } from '@/types'
import { getExtension } from '@/utils/fileUtils'

export const AUDIO_INPUT_EXTENSIONS = [
  'aac',
  'ac3',
  'aif', 'aiff', 'aifc',
  'amr',
  'au',
  'caf',
  'dss',
  'flac',
  'm4a', 'm4b',
  'mp3',
  'oga',
  'voc',
  'wav',
  'weba',
  'wma',
]

// DSS is decode-only; WMA decode works but re-encoding to WMA is not supported
export const AUDIO_OUTPUT_FORMATS = ['mp3', 'aac', 'flac', 'wav', 'ogg', 'aiff', 'm4a', 'ac3', 'au', 'weba']

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aiff: 'audio/aiff',
  m4a: 'audio/mp4',
  ac3: 'audio/ac3',
  au: 'audio/basic',
  weba: 'audio/webm',
}

export const audioEngine: ConversionEngine = {
  id: 'audio',
  name: 'FFmpeg Audio Engine',
  supportedInputExtensions: AUDIO_INPUT_EXTENSIONS,
  outputFormats: AUDIO_OUTPUT_FORMATS,

  async convert(file: File, targetFormat: string, _options: ConversionOptions): Promise<Blob> {
    const sourceExt = getExtension(file)
    const buffer = await file.arrayBuffer()
    const result = await window.electron.convertAudio(buffer, sourceExt, targetFormat)
    return new Blob([result], { type: MIME[targetFormat] ?? 'audio/mpeg' })
  },
}
