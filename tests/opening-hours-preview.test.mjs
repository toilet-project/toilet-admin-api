import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreview, normalize, patternKey } from '../preview/opening-hours-local.mjs'

test('연중무휴는 24시간으로 단정하지 않는다', () => {
  const value = normalize({ openTime:'상시', openTimeDetail:'연중무휴 09:00~18:00' })
  assert.equal(value.open24h,false)
  assert.equal(value.holidayPolicy,'OPEN')
  assert.equal(value.schedules.length,7)
})

test('명시적 24시간만 자동 확정한다', () => {
  const value = normalize({ openTime:'정시', openTimeDetail:'24시간' })
  assert.equal(value.open24h,true)
  assert.equal(value.status,'PARSED')
})

test('상태와 상세 충돌은 검토 대상으로 남긴다', () => {
  const value = normalize({ openTime:'미개방', openTimeDetail:'월~금 09:00~18:00' })
  assert.equal(value.status,'REVIEW_REQUIRED')
  assert.equal(value.open24h,null)
})

test('같은 원문 조합만 하나의 일괄 검토 유형으로 묶는다', () => {
  const first = patternKey({ openTime:'정시', openTimeDetail:'09:00~18:00' })
  const same = patternKey({ openTime:' 정시 ', openTimeDetail:'09:00~18:00 ' })
  const different = patternKey({ openTime:'정시', openTimeDetail:'09:00~19:00' })
  assert.equal(first,same)
  assert.notEqual(first,different)
})

test('유형 확정 뒤 저장값과 변경 내역을 다시 조회한다', async t => {
  const server = await createPreview()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const { port } = server.address()
  const root = `http://127.0.0.1:${port}`
  const patterns = await fetch(`${root}/api/admin/v1/opening-hours/patterns?status=ALL&page=0&size=15`).then(response => response.json())
  const pattern = patterns.items[0]

  await fetch(`${root}/api/admin/v1/opening-hours/patterns/${pattern.patternKey}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({openingPolicy:'ALWAYS',open24h:true,holidayPolicy:'OPEN',schedules:[]})
  })
  const detail = await fetch(`${root}/api/admin/v1/opening-hours/patterns/${pattern.patternKey}`).then(response => response.json())

  assert.equal(detail.confirmed.openingPolicy,'ALWAYS')
  assert.equal(detail.confirmed.open24h,true)
  assert.equal(detail.confirmed.holidayPolicy,'OPEN')
  assert.equal(detail.history.length,1)
  assert.equal(JSON.parse(detail.history[0].detailJson).openingPolicy,'ALWAYS')
})
