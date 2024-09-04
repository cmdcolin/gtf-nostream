import Parser from './parse'

export function parseStringSync(str: string): unknown[] {
  if (!str) {
    return []
  }

  const items: unknown[] = []

  const parser = new Parser({
    // @ts-expect-error
    featureCallback: item => items.push(item),
    // @ts-expect-error
    errorCallback: err => {
      throw err
    },
  })

  for (const line of str.split(/\r?\n/)) {
    parser.addLine(line)
  }
  parser.finish()

  return items
}
