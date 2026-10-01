import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../src/client.js',import.meta.url),'utf8')
const selector='.dbt-final-copy,.dbt-question-surface{'
const start=source.indexOf(selector)
const scoped=source.slice(start,source.indexOf('}',start)+1)
test('Final and question Markdown consume locally rebound task-size font tokens',()=>{
 assert.ok(start>=0)
 assert.ok(scoped.includes('--dbt-text-size:var(--dbt-projection-font-size,13px)'))
 for(const name of ['base','base-strong','h1','h2','h3','h4','table','table-head','code','code-block'])assert.ok(scoped.includes(`--dsw-font-markdown-${name}:`),name)
 assert.match(scoped,/--dsw-font-markdown-base:400 var\(--dbt-text-size\)\//)
 assert.match(scoped,/--dsw-font-markdown-h1:700 calc\(var\(--dbt-text-size\) \+ 7px\)/)
 assert.match(scoped,/--dsw-font-markdown-code-block:400 calc\(var\(--dbt-text-size\) \* 11 \/ 14\)/)
 assert.doesNotMatch(scoped,/dbt-continue|body\{|\.input/)
})
test('native Markdown variant and rendering survive font plumbing; code banner scales locally',()=>{
 const final=source.slice(source.indexOf("if (finalExpanded)"),source.indexOf("return element('article'",source.indexOf('if (finalExpanded)')))
 assert.match(source,/element\(MarkdownText, \{\s*text: finalState\.value\.final\.text/)
 assert.doesNotMatch(final,/variant: 'compact'/)
 assert.ok(source.includes('.dbt-final-copy .md-code-block,.dbt-question-surface .md-code-block{--dsl-code-block-banner-font:'))
 assert.ok(source.includes('[data-code-block-banner] > :first-child{font-size:inherit;line-height:inherit}'))
})
test('question control copy follows the same setting instead of a fixed small font',()=>{
 assert.match(source,/\.dbt-question-surface\{[^}]*font-size:var\(--dbt-projection-font-size,13px\)/)
 assert.match(source,/\.dbt-task-answer\{[^}]*font-size:var\(--dbt-projection-font-size,13px\)/)
 assert.match(source,/element\(handle\.View, \{ fontSize \}\)/)
})
