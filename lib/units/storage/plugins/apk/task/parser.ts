import fs from 'fs/promises'

export type PlistValue = string | number | boolean | PlistValue[] | PlistObject

export interface PlistObject {
  [key: string]: PlistValue
}

interface Token {
  name: string
  closing: boolean
  value: string
}

interface ParseResult {
  value: PlistValue
  next: number
}

type ParseValue = (tokens: Token[], index: number) => ParseResult

var parseValue: ParseValue

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, function(match, code) {
      return String.fromCodePoint(Number(code))
    })
    .replace(/&#x([0-9a-fA-F]+);/g, function(match, code) {
      return String.fromCodePoint(parseInt(code, 16))
    })
}

function tokenize(xml: string) {
  var tokens: Token[] = []
  var pattern = new RegExp(
    '<\\s*(\\/)?\\s*(key|string|integer|real|true|false|date|data|dict|array)' +
      '\\s*(\\/)?\\s*>([^<]*)'
  , 'g'
  )
  var match: RegExpExecArray | null

  while ((match = pattern.exec(xml))) {
    var closing = Boolean(match[1])
    var name = match[2]
    if (name) {
      tokens.push({
        name: name
      , closing: closing
      , value: closing ? '' : decodeXml((match[4] || '').trim())
      })
    }
  }

  return tokens
}

function parseScalar(tokens: Token[], index: number, value: PlistValue) {
  var token = tokens[index]!
  var next = index + 1
  var nextToken = tokens[next]
  if (nextToken && nextToken.closing && nextToken.name === token.name) {
    next += 1
  }

  return {
    value: value
  , next: next
  }
}

function parseArray(tokens: Token[], index: number): ParseResult {
  var value: PlistValue[] = []
  var next = index + 1

  var token = tokens[next]
  while (token && !(token.closing && token.name === 'array')) {
    var child = parseValue(tokens, next)
    value.push(child.value)
    next = child.next
    token = tokens[next]
  }

  return {
    value: value
  , next: token ? next + 1 : next
  }
}

function parseDict(tokens: Token[], index: number): ParseResult {
  var value: PlistObject = {}
  var next = index + 1

  var token = tokens[next]
  while (token && !(token.closing && token.name === 'dict')) {
    var key = token
    if (key.closing || key.name !== 'key') {
      throw new Error('Invalid plist dictionary entry')
    }

    var valueIndex = next + 1
    var valueToken = tokens[valueIndex]
    if (valueToken && valueToken.closing && valueToken.name === 'key') {
      valueIndex += 1
    }
    var child = parseValue(tokens, valueIndex)
    value[key.value] = child.value
    next = child.next
    token = tokens[next]
  }

  return {
    value: value
  , next: token ? next + 1 : next
  }
}

parseValue = function(tokens: Token[], index: number): ParseResult {
  var token = tokens[index]
  if (!token || token.closing) {
    throw new Error('Unexpected end of plist value')
  }

  switch (token.name) {
  case 'dict':
    return parseDict(tokens, index)
  case 'array':
    return parseArray(tokens, index)
  case 'true':
    return parseScalar(tokens, index, true)
  case 'false':
    return parseScalar(tokens, index, false)
  case 'integer':
  case 'real':
    return parseScalar(tokens, index, Number(token.value))
  case 'date':
  case 'data':
  case 'string':
    return parseScalar(tokens, index, token.value)
  default:
    throw new Error('Unsupported plist element "' + token.name + '"')
  }
}

export function parsePlistXml(xml: string): PlistObject {
  var tokens = tokenize(xml)

  for (var i = 0; i < tokens.length; ++i) {
    var token = tokens[i]!
    if (!token.closing && token.name === 'dict') {
      return parseDict(tokens, i).value as PlistObject
    }
  }

  return {}
}

export default function parsePlistFile(filepath: string) {
  return fs.readFile(filepath, 'utf8')
    .then(parsePlistXml)
}
