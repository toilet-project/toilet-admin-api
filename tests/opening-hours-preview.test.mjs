import test from 'node:test'
import assert from 'node:assert/strict'
import { normalize } from '../preview/opening-hours-local.mjs'

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
