//@ts-nocheck
import { test, expect } from 'vitest'
import fs from 'fs'
import { parseStringSync } from '../src'

// https://github.com/GMOD/GBrowse/blob/116a7dfeb1d8ecd524cdeebdc1c1a760938a2fd0/bin/gtf2gff3.pl

function readAll(filename) {
  return parseStringSync(fs.readFileSync(filename, 'utf8'))
}

test('can parse volvox.sorted.gtf', async () => {
  const stuff = readAll('test/data/volvox.sorted.gtf')
  expect(stuff).toMatchSnapshot()
})
;(
  [
    [2, 'demo.gtf'],
    [6, 'volvox.sorted.gtf'],
  ] as const
).forEach(([_count, filename]) => {
  test(`can cursorily parse ${filename}`, async () => {
    const stuff = readAll(`test/data/${filename}`)
    expect(stuff).toMatchSnapshot()
  })
})

test('can parse a string synchronously', () => {
  const gtfString = fs.readFileSync('test/data/demo.gtf').toString('utf8')
  const result = parseStringSync(gtfString, {
    parseFeatures: true,
    parseDirectives: true,
    parseComments: true,
  })
  //  ENSVPAG00000000407 and ENSVPAG00000009976
  expect(result).toMatchSnapshot()
})

test('can parse another string synchronously', () => {
  const gtfLine = `ctgA	example	exon	1050	1500	.	+	.	transcript_id "EDEN.1"; gene_id "EDEN"; gene_name "EDEN";
  `

  const result = parseStringSync(gtfLine, {
    parseFeatures: true,
    parseDirectives: true,
    parseComments: true,
  })

  expect(result).toMatchSnapshot()
  // trying to support the Cufflinks convention of adding a transcript line
  // can't do a round trip since the output adds transcripts as parent features
})
