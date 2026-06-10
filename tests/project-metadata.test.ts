import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const FILES_WITH_REPO_REFERENCES = [
  'docker/docker-compose.yml',
  'docker/Dockerfile',
  'docker/README.md',
  'docs/superpowers/specs/2026-05-29-electron-desktop-client-design.md',
  'docs/superpowers/plans/2026-05-29-electron-desktop-client.md',
]

test('project metadata no longer references the old finance_sys repository name', () => {
  for (const file of FILES_WITH_REPO_REFERENCES) {
    const text = fs.readFileSync(file, 'utf8')
    assert.equal(text.includes('finance_sys'), false, `${file} still references finance_sys`)
  }
})
