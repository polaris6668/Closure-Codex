import { access, copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = new URL('../', import.meta.url)
await mkdir(new URL('lib/', root), { recursive: true })
for (const name of ['linked-state.cjs', 'error-summary.cjs']) {
  const destination = fileURLToPath(new URL(`lib/${name}`, root))
  try { await copyFile(fileURLToPath(new URL(`../../outputs/closure-companion/${name}`, root)), destination) }
  catch (error) { if (error.code !== 'ENOENT') throw error; await access(destination) }
}
