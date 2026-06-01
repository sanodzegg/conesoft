import type { ConversionEngine } from './ConversionEngine'
import type { ConversionOptions } from '@/types'
import { getExtension } from '@/utils/fileUtils'

const MIME: Record<string, string> = {
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export const documentEngine: ConversionEngine = {
  id: 'document',
  name: 'Document Engine',
  supportedInputExtensions: ['pdf', 'docx', 'txt'],
  outputFormats: ['txt', 'docx', 'pdf'],

  async convert(file: File, targetFormat: string, _options: ConversionOptions): Promise<Blob> {
    const sourceFormat = getExtension(file)
    const buffer = await file.arrayBuffer()
    const result = await window.electron.convertDocument(buffer, targetFormat, sourceFormat)
    return new Blob([result], { type: MIME[targetFormat] })
  },
}
