import { z } from 'zod'
const id = z.string().uuid()
const address = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9_.:\-]+$/, '地址只能包含主机名或 IP')
const clean = z
  .string()
  .max(8192)
  .refine((s) => !s.includes('\0'), '不允许空字符')
export const hostSchema = z.object({
  id,
  sshAlias: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/)
    .optional(),
  name: z.string().trim().min(1).max(100),
  hostname: address,
  port: z.number().int().min(1).max(65535),
  username: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\s\0]+$/),
  auth: z.enum(['agent', 'key', 'password']),
  privateKeyPath: clean,
  jumpHostId: z.union([id, z.literal('')]),
  secret: clean.optional()
})
export const appSchema = z
  .object({
    id,
    hostId: id,
    name: z.string().trim().min(1).max(100),
    hostname: address,
    port: z.number().int().min(1).max(65535),
    protocol: z.enum(['http', 'https']),
    path: clean.refine(
      (p) => p.startsWith('/') && !p.startsWith('//'),
      '路径必须以 / 开头'
    ),
    startCommand: clean,
    workingDirectory: clean,
    environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), clean),
    healthPath: clean.refine(
      (p) => p.startsWith('/') && !p.startsWith('//'),
      '检查路径必须以 / 开头'
    ),
    expectedText: z.string().max(1000),
    readyTimeout: z.number().int().min(5).max(300),
    autoStart: z.boolean()
  })
  .refine(
    (a) => !a.autoStart || Boolean(a.startCommand.trim()),
    '自动启动需要启动命令'
  )
export const idSchema = id
export const boundsSchema = z.object({
  x: z.number().min(0).max(20000),
  y: z.number().min(0).max(20000),
  width: z.number().min(0).max(20000),
  height: z.number().min(0).max(20000)
})
export function appUrl(app: {
  protocol: string
  hostname: string
  port: number
  path: string
}): string {
  const host =
    app.hostname.includes(':') && !app.hostname.startsWith('[')
      ? `[${app.hostname}]`
      : app.hostname
  return `${app.protocol}://${host}:${app.port}${app.path}`
}
