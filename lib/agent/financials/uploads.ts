import type { FinancialAnalysisInput } from '@/lib/agent/financials/schema'
import { cleanFinancialDisplayText } from '@/lib/agent/financials/schema'

export type UploadedFinancialDocument = FinancialAnalysisInput['documents'][number]

const MAX_UPLOAD_SIZE = 12 * 1024 * 1024
const MAX_TEXT_LENGTH = 80_000
const SUPPORTED_TEXT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/csv',
  'text/html',
  'application/json',
]

function normalizeText(text: string) {
  return cleanFinancialDisplayText(text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' '))
    .slice(0, MAX_TEXT_LENGTH)
}

function inferTextFile(file: File) {
  const name = file.name.toLowerCase()
  return SUPPORTED_TEXT_TYPES.includes(file.type) || /\.(txt|md|csv|json|html?)$/i.test(name)
}

async function extractPdfText(buffer: Buffer) {
  const pdfParse = (await import('pdf-parse')).default
  const result = await pdfParse(buffer)
  return normalizeText(result.text || '')
}

async function extractTextFile(file: File, buffer: Buffer) {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const text = decoder.decode(buffer)
  return normalizeText(text)
}

export async function parseFinancialUpload(file: File): Promise<UploadedFinancialDocument> {
  if (file.size <= 0) throw new Error(`文件为空：${file.name}`)
  if (file.size > MAX_UPLOAD_SIZE) throw new Error(`文件过大：${file.name}，单个文件不能超过 12MB`)

  const buffer = Buffer.from(await file.arrayBuffer())
  const lowerName = file.name.toLowerCase()
  const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf')
  const excerpt = isPdf
    ? await extractPdfText(buffer)
    : inferTextFile(file)
      ? await extractTextFile(file, buffer)
      : ''

  if (!excerpt) {
    throw new Error(`暂不支持解析该文件类型：${file.name}。请上传 PDF、TXT、Markdown、HTML、CSV 或 JSON 文件。`)
  }

  return {
    title: file.name,
    publisher: 'manual-upload',
    excerpt,
  }
}

export async function parseFinancialUploads(files: File[]) {
  const documents: UploadedFinancialDocument[] = []
  const errors: string[] = []

  for (const file of files.slice(0, 3)) {
    try {
      documents.push(await parseFinancialUpload(file))
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `文件解析失败：${file.name}`)
    }
  }

  return { documents, errors }
}
