//@ts-nocheck
import * as GTF from './util'

const containerAttributes = {
  Parent: 'child_features',
  Derives_from: 'derived_features',
}

export default class Parser {
  constructor(args) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const nullFunc = () => {}

    Object.assign(this, {
      featureCallback: args.featureCallback || nullFunc,
      endCallback: args.endCallback || nullFunc,
      commentCallback: args.commentCallback || nullFunc,
      errorCallback: args.errorCallback || nullFunc,
      directiveCallback: args.directiveCallback || nullFunc,
      sequenceCallback: args.sequenceCallback || nullFunc,

      // number of lines to buffer
      bufferSize: args.bufferSize === undefined ? 1000 : args.bufferSize,

      // features that we have to keep on hand for now because they
      // might be referenced by something else
      _underConstructionTopLevel: [],
      // index of the above by ID
      _underConstructionById: {},

      _completedReferences: {},

      // features that reference something we have not seen yet
      // structured as:
      // {  'some_id' : {
      //     'Parent' : [ orphans that have a Parent attr referencing it ],
      //     'Derives_from' : [ orphans that have a Derives_from attr referencing it ],
      //    }
      // }
      _underConstructionOrphans: {},

      // if this is true, the parser ignores the
      // rest of the lines in the file.
      eof: false,

      lineNumber: 0,
    })
  }

  addLine(line) {
    if (this.eof) {
      // otherwise, if we are done, ignore this line
      return
    }

    this.lineNumber += 1

    if (/^\s*[^#\s>]/.test(line)) {
      // feature line, most common case
      this._bufferLine(line)
      return
    }

    const match = /^\s*(#+)(.*)/.exec(line)
    if (match) {
      // directive or comment
      // eslint-disable-next-line prefer-const
      let [, hashsigns, contents] = match

      if (hashsigns.length === 3) {
        // sync directive, all forward-references are resolved.
        this._emitAllUnderConstructionFeatures()
      } else if (hashsigns.length === 2) {
        const directive = GTF.parseDirective(line)

        this._emitItem(directive)
      } else {
        contents = contents.replace(/\s*/, '')
        this._emitItem({ comment: contents })
      }
    } else if (/^\s*$/.test(line)) {
      // blank line, do nothing
    } else {
      // it's a parse error
      const errLine = line.replace(/\r?\n?$/g, '')
      throw new Error(`GTF parse error.  Cannot parse '${errLine}'.`)
    }
  }

  _emitItem(i) {
    if (i[0]) {
      this.featureCallback(i)
    } else if (i.directive) {
      this.directiveCallback(i)
    } else if (i.comment) {
      this.commentCallback(i)
    }
  }

  finish() {
    this._emitAllUnderConstructionFeatures()
    this.endCallback()
  }

  _enforceBufferSizeLimit(additionalItemCount = 0) {
    const _unbufferItem = item => {
      if (
        item?.[0]?.attributes?.ID?.[0]
      ) {
        const ids = item[0].attributes.ID
        ids.forEach(id => {
          delete this._underConstructionById[id]
          delete this._completedReferences[id]
        })
        item.forEach(i => {
          if (i.child_features) {
            i.child_features.forEach(c => { _unbufferItem(c) })
          }
          if (i.derived_features) {
            i.derived_features.forEach(d => { _unbufferItem(d) })
          }
        })
      }
    }

    while (
      this._underConstructionTopLevel.length + additionalItemCount >
      this.bufferSize
    ) {
      const item = this._underConstructionTopLevel.shift()
      this._emitItem(item)
      _unbufferItem(item)
    }
  }

  /**
   * return all under-construction features, called when we know
   * there will be no additional data to attach to them
   * @private
   */
  _emitAllUnderConstructionFeatures() {
    this._underConstructionTopLevel.forEach(this._emitItem.bind(this))

    this._underConstructionTopLevel = []
    this._underConstructionById = {}
    this._completedReferences = {}

    // if we have any orphans hanging around still, this is a
    // problem. die with a parse error
    if (
      Object.values(this._underConstructionOrphans).filter(
        entry => Object.keys(entry).length,
      ).length
    ) {
      throw new Error(
        `some features reference other features that do not exist in the file (or in the same '###' scope). ${JSON.stringify(
          this._underConstructionOrphans,
        )}`,
      )
    }
  }

  // do the right thing with a newly-parsed feature line
  _bufferLine(line) {
    const featureLine = GTF.parseFeature(line)
    featureLine.child_features = []
    featureLine.derived_features = []
    // featureLine._lineNumber = this.lineNumber //< debugging aid

    const featureNumber = this.lineNumber // no such thing as unique ID in GTF. make one up.
    const isTranscript = featureLine.featureType === 'transcript' // trying to support the Cufflinks convention of adding a transcript line
    // NOTE: a feature is an arrayref of one or more feature lines.
    const ids = isTranscript
      ? featureLine.attributes.transcript_id || []
      : [featureNumber]
    const parents = isTranscript
      ? []
      : featureLine.attributes.transcript_id || []
    const derives = featureLine.attributes.Derives_from || []

    if (!ids.length && !parents.length && !derives.length) {
      // if it has no IDs and does not refer to anything, we can just
      // output it
      this._emitItem([featureLine])
      return
    }

    function createTranscript(feature) {
      const result = JSON.parse(JSON.stringify(feature))
      result.featureType = 'transcript'
      return GTF.formatFeature(result)
    }

    parents.forEach(parent => {
      const underConst = this._underConstructionById[parent]
      if (!underConst) {
        this._bufferLine(createTranscript(featureLine))
      }
    })

    let feature
    ids.forEach(id => {
      const existing = this._underConstructionById[id]
      if (existing) {
        existing.push(featureLine)
        feature = existing
      } else {
        // haven't seen it yet, so buffer it so we can attach
        // child features to it
        feature = [featureLine]

        this._enforceBufferSizeLimit(1)
        if (!parents.length && !derives.length) {
          this._underConstructionTopLevel.push(feature)
        }
        this._underConstructionById[id] = feature

        // see if we have anything buffered that refers to it
        this._resolveReferencesTo(feature, id)
      }
    })

    // try to resolve all its references
    this._resolveReferencesFrom(
      feature || [featureLine],
      { Parent: parents, Derives_from: derives },
      ids,
    )
  }

  _resolveReferencesTo(feature, id) {
    const references = this._underConstructionOrphans[id]
    if (!references) {
      return
    }

    Object.keys(references).forEach(attrname => {
      const pname = containerAttributes[attrname] || attrname.toLowerCase()
      feature.forEach(loc => {
        loc[pname].push(...references[attrname])
        delete references[attrname]
      })
    })
  }

  _parseError(message) {
    this.eof = true
    this.errorCallback(`${this.lineNumber}: ${message}`)
  }

  _resolveReferencesFrom(feature, references, ids) {
    // this is all a bit more awkward in javascript than it was in perl
    function postSet(obj, slot1, slot2) {
      let subObj = obj[slot1]
      if (!subObj) {
        subObj = {}
         
        obj[slot1] = subObj
      }
      const returnVal = subObj[slot2] || false
      subObj[slot2] = true
      return returnVal
    }

    function expandFeature(parentFeature, childFeature) {
       
      parentFeature[0].start = Math.min(
        parentFeature[0].start,
        childFeature[0].start,
      )
       
      parentFeature[0].end = Math.max(parentFeature[0].end, childFeature[0].end)
    }

    Object.entries(references).forEach(([attrname, toIds]) => {
      let pname
      toIds.forEach(toId => {
        const otherFeature = this._underConstructionById[toId]
        if (otherFeature) {
          expandFeature(otherFeature, feature)
          if (!pname) {
            pname = containerAttributes[attrname] || attrname.toLowerCase()
          }

          if (
            !ids.filter(id =>
              postSet(this._completedReferences, id, `${attrname},${toId}`),
            ).length
          ) {
            otherFeature.forEach(location => {
              location[pname].push(feature)
            })
          }
        } else {
          if (!this._underConstructionOrphans[toId]) {
            this._underConstructionOrphans[toId] = {}
          }
          if (!this._underConstructionOrphans[toId][attrname]) {
            this._underConstructionOrphans[toId][attrname] = []
          }
          this._underConstructionOrphans[toId][attrname].push(feature)
        }
      })
    })
  }
}
