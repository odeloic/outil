import { lstat, mkdir, readlink, stat, symlink, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = new URL('../.claude/skills/', import.meta.url)
const parent = new URL('../.agents/', import.meta.url)
const destination = new URL('skills', parent)
const target = '../.claude/skills'

if (!(await stat(source)).isDirectory()) {
  throw new Error('.claude/skills must be a directory')
}

const existing = await lstat(destination).catch((error) => {
  if (error.code !== 'ENOENT') throw error
  return undefined
})

if (existing && !existing.isSymbolicLink()) {
  throw new Error('Refusing to replace .agents/skills: it is not a symlink')
}

if (existing && (await readlink(destination)) === target) {
  console.log('.agents/skills is already linked to .claude/skills')
} else {
  await mkdir(parent, { recursive: true })
  if (existing) await unlink(destination)
  await symlink(target, fileURLToPath(destination), 'dir')
  console.log('Linked .agents/skills to .claude/skills')
}
