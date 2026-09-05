import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/main/resources/static/reports.js', import.meta.url), 'utf8')
  .replace(/bootstrap\(\)\s*$/, '')

function fixture() {
  const nodes = new Map()
  const maps = []
  const callbacks = []
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      isConnected: true,
      textContent: '',
      handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler },
      remove() { this.isConnected = false },
    })
    return nodes.get(id)
  }
  class LatLng {
    constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude }
    getLat() { return this.latitude }
    getLng() { return this.longitude }
  }
  const context = vm.createContext({
    document: { getElementById: node },
    kakao: { maps: {
      LatLng,
      Map: class {
        constructor(target, options) { this.target = target; this.options = options; this.handlers = {}; maps.push(this) }
        setCenter(position) { this.center = position }
      },
      Marker: class {
        constructor(options) { this.position = options.position; this.handlers = {} }
        setPosition(position) { this.position = position }
        getPosition() { return this.position }
      },
      event: { addListener(target, event, handler) { target.handlers[event] = handler } },
      services: {
        Status: { OK: 'OK' },
        Geocoder: class { coord2Address(longitude, latitude, callback) { callbacks.push(callback) } },
      },
    } },
  })
  vm.runInContext(source, context)
  vm.runInContext('selectedReportId = 7; kakaoMapsReady = Promise.resolve()', context)
  const report = { id: 7, latitude: 37.5, longitude: 127, roadAddress: null, jibunAddress: '서울특별시 테스트동 1' }
  const toilet = { latitude: null, longitude: null, jibunAddress: '현재 지번주소' }
  return {
    context, node, maps, callbacks, report, toilet,
    async draw() { await context.drawLocationMap(report, toilet, true) },
    click(latitude, longitude) { maps.at(-1).handlers.click({ latLng: new LatLng(latitude, longitude) }) },
    resolve(index, address) { callbacks[index]([{ address: { address_name: address } }], 'OK') },
    confirmation() { return vm.runInContext('locationConfirmation', context) },
  }
}

test('missing, blank and invalid coordinates do not create a zero-coordinate map', () => {
  const { context } = fixture()
  for (const value of [null, undefined, '', ' ', 'not-a-number']) {
    assert.equal(context.hasCoordinates(value, 127), false)
    assert.equal(context.hasCoordinates(37.5, value), false)
  }
  assert.equal(context.hasCoordinates('37.5', '127'), true)
})

test('a jibun-only report shows its address and the missing current-coordinate message', () => {
  const { context, report, toilet } = fixture()
  const html = context.locationDetailMarkup(report, toilet)
  assert.match(html, /서울특별시 테스트동 1/)
  assert.match(html, /현재 등록 좌표가 없습니다/)
  assert.doesNotMatch(html, /id="current-location-map"/)
})

test('road address takes precedence when both report addresses exist', () => {
  const { context, report, toilet } = fixture()
  report.roadAddress = '서울특별시 테스트로 1'
  const html = context.locationDetailMarkup(report, toilet)
  assert.match(html, /서울특별시 테스트로 1/)
  assert.doesNotMatch(html, /서울특별시 테스트동 1/)
})

test('jibun-only report initializes and resets the approval preview', async () => {
  const f = fixture()
  await f.draw()
  assert.equal(f.maps.length, 1)
  assert.equal(f.confirmation().roadAddress, f.report.jibunAddress)
  f.click(37.6, 127.1)
  f.node('reset-approved-location').handlers.click()
  f.resolve(0, '늦게 도착한 주소')
  assert.equal(f.confirmation().latitude, 37.5)
  assert.equal(f.confirmation().roadAddress, f.report.jibunAddress)
})

test('out-of-order reverse-geocoding responses cannot restore an older coordinate', async () => {
  const f = fixture()
  await f.draw()
  f.click(37.6, 127.1)
  f.click(37.7, 127.2)
  f.resolve(1, '최신 지번주소')
  f.resolve(0, '이전 지번주소')
  assert.equal(f.confirmation().latitude, 37.7)
  assert.equal(f.confirmation().roadAddress, '최신 지번주소')
})

test('a closed report ignores a pending reverse-geocoding response', async () => {
  const f = fixture()
  await f.draw()
  f.click(37.6, 127.1)
  f.node('approved-location-map').isConnected = false
  vm.runInContext('selectedReportId = null; locationConfirmation = null', f.context)
  f.resolve(0, '닫힌 제보 주소')
  assert.equal(f.confirmation(), null)
})
