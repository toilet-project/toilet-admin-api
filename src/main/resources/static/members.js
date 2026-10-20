const authPageRoot = document.getElementById('members-shell')
const el = (id) => document.getElementById(id)
const API_BASE = 'https://api.geupddong.com'
const PAGE_SIZE = 20
let currentPage = 0, totalPages = 0, searchTimer
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
const parseKoreanDate = (value) => new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+09:00`)
const date = (value) => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(parseKoreanDate(value)) : '-'
const statusLabel = (status) => ({ ACTIVE: '활성', SUSPENDED: '정지', WITHDRAWN: '탈퇴' })[status] || status

function renderPagination() {
  const target = el('member-pagination')
  target.replaceChildren()
  if (totalPages <= 1) return
  ;[['이전', currentPage > 0, currentPage - 1], [`${currentPage + 1} / ${totalPages}`, false], ['다음', currentPage < totalPages - 1, currentPage + 1]].forEach(([label, enabled, page], index) => {
    const node = document.createElement(index === 1 ? 'span' : 'button')
    node.textContent = label
    if (index !== 1) {
      node.type = 'button'
      node.className = 'secondary-button'
      node.disabled = !enabled
      node.addEventListener('click', () => void loadMembers(page))
    }
    target.append(node)
  })
}

function renderMembers(items) {
  const body = el('member-list')
  body.replaceChildren()
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="5">조건에 맞는 회원이 없습니다.</td></tr>'
    return
  }
  items.forEach((member) => {
    const row = document.createElement('tr')
    row.innerHTML = `<td><strong>${escapeHtml(member.displayName || `회원 #${member.id}`)}</strong><small>#${member.id}</small></td><td>${escapeHtml(member.email || '-')}</td><td><span class="account-status ${String(member.status).toLowerCase()}">${statusLabel(member.status)}</span></td><td>${member.roles.map((role) => `<span class="role-badge ${role.toLowerCase()}">${escapeHtml(role)}</span>`).join(' ')}</td><td>${escapeHtml(date(member.lastLoginAt))}</td>`
    body.append(row)
  })
}

async function loadMembers(page = 0) {
  const status = el('member-status-text')
  status.className = 'status'
  status.textContent = '회원을 불러오는 중입니다.'
  try {
    const query = new URLSearchParams({ keyword: el('member-keyword').value.trim(), role: '', status: el('member-status').value, page: String(Math.max(page, 0)), size: String(PAGE_SIZE) })
    const response = await fetch(`${API_BASE}/api/admin/v1/security/users?${query}`, { credentials: 'include' })
    if (!response.ok) throw new Error('회원 목록을 불러오지 못했습니다.')
    const data = await response.json()
    currentPage = data.page
    totalPages = data.totalPages
    renderMembers(data.items)
    renderPagination()
    status.textContent = data.totalElements ? `회원 ${data.totalElements}명 · ${currentPage + 1}페이지` : '조건에 맞는 회원이 없습니다.'
  } catch (error) {
    renderMembers([])
    totalPages = 0
    renderPagination()
    status.className = 'status is-error'
    status.textContent = error.message
  }
}

async function bootstrap() {
  try {
    if (!await AdminAuth.start(authPageRoot)) return;
    el('member-keyword').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => void loadMembers(0), 250) })
    el('member-status').addEventListener('change', () => void loadMembers(0))
    el('member-refresh').addEventListener('click', () => void loadMembers(0))
    await loadMembers()
  } catch {
    if (authPageRoot?.isConnected) {
      const status = document.getElementById('member-status-text')
      if (status) { status.hidden = false; status.textContent = '화면을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.' }
    }
  }
}

bootstrap()
