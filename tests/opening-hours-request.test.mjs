import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../src/main/resources/static/opening-hours.js', import.meta.url), 'utf8')
  .replace(/bootstrap\(\)\s*$/, '')

for (const [payload, message] of [
  [{ error: { code: 'INVALID_REQUEST', message: '감사 로그 상세 정보를 직렬화할 수 없습니다.' } }, '감사 로그 상세 정보를 직렬화할 수 없습니다.'],
  [{ message: '요일을 확인해 주세요.' }, '요일을 확인해 주세요.'],
  [null, '요청을 처리하지 못했습니다.'],
]) {
  test(`저장 실패 사유를 전달한다: ${message}`, async () => {
    const context = createContext({
      location: { hostname: 'admin.geupddong.com', pathname: '/opening-hours.html' },
      document: { addEventListener() {} },
      fetch: async () => ({ ok: false, status: 400, json: async () => payload }),
    })
    runInContext(source, context)
    await assert.rejects(context.request('/api/admin/v1/opening-hours/patterns/example', { method: 'PUT' }),
      error => error.message === message)
  })
}
