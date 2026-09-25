// Invoked by OpenSSH, including nested ProxyJump/ProxyCommand ssh processes.
const net = require('node:net')
const socket = net.connect(process.env.PORTICO_ASKPASS_SOCKET)
let input = ''
socket.on('connect', () =>
  socket.write(
    JSON.stringify({
      token: process.env.PORTICO_ASKPASS_TOKEN,
      message: process.argv[2] || 'SSH authentication',
      hint: process.env.SSH_ASKPASS_PROMPT || ''
    }) + '\n'
  )
)
socket.on('error', () => process.exit(1))
socket.on('data', (data) => {
  input += data.toString()
  if (input.length > 65536) process.exit(1)
  if (!input.includes('\n')) return
  try {
    const { answer } = JSON.parse(input.split('\n')[0])
    if (typeof answer !== 'string') process.exit(1)
    process.stdout.write(answer + '\n', () => process.exit(0))
  } catch {
    process.exit(1)
  }
})
socket.on('end', () => {
  if (!input.includes('\n')) process.exit(1)
})
socket.setTimeout(180000, () => process.exit(1))
