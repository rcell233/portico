let confirmation = false
window.sshPrompt.ready(({ host, message, hint }) => {
  document.querySelector('#title').textContent = `连接 ${host}`
  document.querySelector('#message').textContent = message
  confirmation =
    hint === 'confirm' || /yes\/no(?:\/\[fingerprint\])?/i.test(message)
  const input = document.querySelector('#answer')
  input.hidden = confirmation || hint === 'none'
  if (confirmation) {
    document.querySelector('#submit').textContent = '确认并连接'
    document.querySelector('#note').textContent =
      '请核对 SSH 提示与服务器指纹；确认结果由 OpenSSH 按本机配置处理。'
  }
  if (!input.hidden) input.focus()
})
document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault()
  window.sshPrompt.answer(
    confirmation ? 'yes' : document.querySelector('#answer').value
  )
  document.querySelector('#answer').value = ''
})
document
  .querySelector('#cancel')
  .addEventListener('click', () => window.sshPrompt.answer(null))
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.sshPrompt.answer(null)
})
