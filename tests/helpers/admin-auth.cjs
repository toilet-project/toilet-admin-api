const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../../src/main/resources/static/admin-auth.js'), 'utf8')

function element() {
  return {
    hidden: true, isConnected: true, dataset: {}, textContent: '', children: [],
    handlers: {}, classList: { add() {}, remove() {}, toggle() {} },
    append(node) { this.children.push(node) },
    addEventListener(name, handler) { this.handlers[name] = handler },
  }
}

// Supply the shared chrome around page-specific fixtures and run the actual
// authentication controller, so navigation regressions exercise both modules.
function installAuth(context) {
  const document = context.document
  const shared = new Map(['auth-shell', 'auth-title', 'auth-description', 'auth-retry', 'loading-shell']
    .map(id => [id, document.getElementById(id) || element()]))
  const actions = element(), card = element(), frame = document.getElementById('dashboard-shell') || element()
  shared.get('auth-shell').querySelector = selector => selector === '.login-actions' ? actions : card
  const get = document.getElementById.bind(document)
  document.getElementById = id => shared.get(id) || get(id)
  const queryAll = document.querySelectorAll?.bind(document)
  document.querySelectorAll = selector => selector === '.admin-frame' ? [frame] : queryAll?.(selector) || []
  document.documentElement ||= { dataset: {} }
  document.addEventListener ||= () => {}
  context.AbortController ||= AbortController
  context.AbortSignal ||= AbortSignal
  context.setTimeout ||= setTimeout
  context.clearTimeout ||= clearTimeout
  vm.runInContext(source, context, { filename: 'admin-auth.js' })
  return { auth: context.AdminAuth, frame, actions, node: id => shared.get(id) }
}

module.exports = { installAuth, element }
