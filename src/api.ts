import Parser from './parse'

/** Parser options */
export interface ParseOptions {
  /** Whether to resolve references to derives from features */
  disableDerivesFromReferences?: boolean
  /** Text encoding of the input GTF. default 'utf8' */
  encoding?: BufferEncoding
  /** Whether to parse features, default true */
  parseFeatures?: boolean
  /** Whether to parse directives, default false */
  parseDirectives?: boolean
  /** Whether to parse comments, default false */
  parseComments?: boolean
  /** Whether to parse sequences, default true */
  parseSequences?: boolean
  /**
   * Parse all features, directives, comments, and sequences. Overrides other
   * parsing options. Default false.
   */
  parseAll?: boolean
}

type ParseOptionsProcessed = Required<Omit<ParseOptions, 'parseAll'>>

// shared arg processing for the parse routines
function _processParseOptions(options: ParseOptions): ParseOptionsProcessed {
  const out = {
    encoding: 'utf8' as const,
    parseFeatures: true,
    parseDirectives: false,
    parseSequences: true,
    parseComments: false,
    disableDerivesFromReferences: false,
    ...options,
  }

  if (options.parseAll) {
    out.parseFeatures = true
    out.parseDirectives = true
    out.parseComments = true
    out.parseSequences = true
  }

  return out
}

export function parseStringSync(
  str: string,
  inputOptions: ParseOptions = {},
): unknown[] {
  if (!str) {
    return []
  }

  const options = _processParseOptions(inputOptions)
  const items: unknown[] = []
  const push = items.push.bind(items)

  const parser = new Parser({
    featureCallback: options.parseFeatures ? push : undefined,
    directiveCallback: options.parseDirectives ? push : undefined,
    commentCallback: options.parseComments ? push : undefined,
    sequenceCallback: options.parseSequences ? push : undefined,
    disableDerivesFromReferences: options.disableDerivesFromReferences || false,
    // @ts-expect-error
    errorCallback: err => {
      throw err
    },
  })

  str.split(/\r?\n/).forEach(parser.addLine.bind(parser))
  parser.finish()

  return items
}
