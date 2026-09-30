((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ApiUsageMath = factory()
})(globalThis, () => {
  const percent = (used, free) => used == null || free <= 0 ? null : used / free * 100
  function quota(metric, used, projected, start, asOf, end) {
    if (metric.unlimited) return { kind: 'unlimited', current: null, projected: null, dailyAverage: null }
    if (metric.free === 0) return { kind: 'none', current: null, projected: null, dailyAverage: null }
    if (metric.period === 'day') {
      const days = (Date.parse(end) - Date.parse(start)) / 86400000
      const average = projected == null || !(days > 0) ? null : projected / days
      return { kind: 'daily', current: null, projected: percent(average,metric.free), dailyAverage: average }
    }
    return { kind: 'monthly', current: percent(used,metric.free), projected: percent(projected,metric.free), dailyAverage: null }
  }
  function change(value, previous) {
    if (value == null || previous == null) return { kind: 'unknown', delta: null, percent: null }
    if (previous === 0) return { kind: value === 0 ? 'flat' : 'new', delta: value, percent: value === 0 ? 0 : null }
    return { kind: 'percent', delta: value - previous, percent: (value - previous) / previous * 100 }
  }
  function comparable(a,b) {
    return !!a && !!b && b.status === 'complete' && ['complete','current'].includes(a.status)
      && a.source === b.source && a.scope === b.scope && a.source != null
  }
  return { quota, change, comparable }
})
