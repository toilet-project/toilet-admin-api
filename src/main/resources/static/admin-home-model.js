(function (root, factory) {
  const model = factory()
  if (typeof module === 'object' && module.exports) module.exports = model
  root.AdminHomeModel = model
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const REVIEW_SIZE = 7
  const KST_OFFSET = 9 * 60 * 60 * 1000

  function nextBatchInstant(value = new Date()) {
    const now = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(now.getTime())) throw new TypeError('A valid date is required.')
    const korean = new Date(now.getTime() + KST_OFFSET)
    let next = new Date(Date.UTC(
      korean.getUTCFullYear(), korean.getUTCMonth(), korean.getUTCDate(), -7, 0, 0,
    ))
    if (next <= now) next = new Date(next.getTime() + 86400000)
    return next
  }

  function reviewPage(totalElements, page, itemCount) {
    const total = Math.max(0, Number(totalElements) || 0)
    const currentPage = Math.max(0, Number(page) || 0)
    const count = Math.max(0, Number(itemCount) || 0)
    const start = currentPage * REVIEW_SIZE
    return {
      start,
      first: total ? start + 1 : 0,
      last: total ? Math.min(start + count, total) : 0,
      totalPages: Math.ceil(total / REVIEW_SIZE),
    }
  }

  function reviewHref(type, item) {
    if (type === 'reports') return `/reports.html?reportId=${encodeURIComponent(item.id)}`
    if (type === 'coordinates') return `/data-quality.html?groupKey=${encodeURIComponent(item.groupKey)}`
    if (type === 'regions') return `/regions.html?toiletId=${encodeURIComponent(item.toiletId)}`
    throw new TypeError(`Unsupported review type: ${type}`)
  }

  return { REVIEW_SIZE, nextBatchInstant, reviewPage, reviewHref }
})
