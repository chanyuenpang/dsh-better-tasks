import fs from 'node:fs'

const file = process.argv[2]
const ranges = process.argv.slice(3).map((r) => r.split('-').map(Number))
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
for (const [a, b] of ranges) {
  console.log(`\n===== ${a}-${b} =====`)
  for (let i = a - 1; i < b && i < lines.length; i++) console.log(`${i + 1}: ${lines[i]}`)
}
