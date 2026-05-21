import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFinancialUpload } from '@/lib/agent/financials/uploads'

test('financial upload parser reads plain text reports', async () => {
  const file = new File(['Revenue increased 12%. Net profit improved.'], 'report.txt', { type: 'text/plain' })
  const doc = await parseFinancialUpload(file)

  assert.equal(doc.title, 'report.txt')
  assert.equal(doc.publisher, 'manual-upload')
  assert.match(doc.excerpt, /Revenue increased/)
})

test('financial upload parser strips html tags', async () => {
  const file = new File(['<html><body><h1>Annual Results</h1><script>bad()</script><p>Cash flow improved.</p></body></html>'], 'report.html', { type: 'text/html' })
  const doc = await parseFinancialUpload(file)

  assert.match(doc.excerpt, /Annual Results/)
  assert.match(doc.excerpt, /Cash flow improved/)
  assert.doesNotMatch(doc.excerpt, /script|bad/)
})

test('financial upload parser rejects unsupported file types', async () => {
  const file = new File(['binary'], 'report.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

  await assert.rejects(() => parseFinancialUpload(file), /暂不支持解析该文件类型/)
})
