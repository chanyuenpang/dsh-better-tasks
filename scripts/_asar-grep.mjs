import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
const patterns = process.argv.slice(3).map((p) => new RegExp(p, 'i'))
const files = []
function walk(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(js|mjs|cjs)$/.test(e.name)) files.push(p)
  }
}
walk(root)
let hits = 0
for (const f of files) {
  let text
  try { text = fs.readFileSync(f, 'utf8') } catch { continue }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((re) => re.test(lines[i]))) {
      console.log(`${f.slice(root.length + 1)}:${i + 1}: ${lines[i].trim().slice(0, 260)}`)
      if (++hits > 120) { console.log('...truncated'); process.exit(0) }
    }
  }
}
console.error(`scanned ${files.length} files, ${hits} hits`)
