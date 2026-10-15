import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'

import {expect} from 'chai'

interface Operation {
  operationId?: string
  responses?: Record<string, {
    schema?: {
      $ref?: string
    }
  }>
}

interface PathItem {
  get?: Operation
  put?: Operation
  post?: Operation
  delete?: Operation
}

interface Definition {
  required?: string[]
  properties?: Record<string, {
    type?: string
    enum?: string[]
  }>
}

interface SwaggerDoc {
  paths: Record<string, PathItem>
  definitions: Record<string, Definition>
}

// js-yaml comes with the swagger middleware of the API unit, which loads the same file
var yaml = createRequire(import.meta.url)('js-yaml') as {load(text: string): unknown}

describe('zebrunner: API contract', function() {
  var swagger: SwaggerDoc

  before(async function() {
    swagger = yaml.load(await readFile(
      new URL('../../../lib/units/api/swagger/api_v1.yaml', import.meta.url)
    , 'utf8'
    )) as SwaggerDoc
  })

  it('should expose fork device helper routes', function() {
    expect(swagger.paths['/devices/{serial}/size']!.get!.operationId).to.equal('getDeviceSize')
    expect(swagger.paths['/devices/{serial}/owner']!.get!.operationId).to.equal('getDeviceOwner')
    expect(swagger.paths['/devices/{serial}/type']!.get!.operationId).to.equal('getDeviceType')
    expect(
      swagger.paths['/devices/{serial}/size']!.get!.responses!['200']!.schema!.$ref
    ).to.equal('#/definitions/SizeResponse')
    expect(
      swagger.paths['/devices/{serial}/owner']!.get!.responses!['200']!.schema!.$ref
    ).to.equal('#/definitions/OwnerResponse')
    expect(
      swagger.paths['/devices/{serial}/type']!.get!.responses!['200']!.schema!.$ref
    ).to.equal('#/definitions/TypeResponse')
  })

  it('should document fork access-token and device-status contracts', function() {
    expect(swagger.paths['/user/fullAccessTokens']!.get!.operationId).to.equal('getAccessTokens')
    expect(swagger.paths['/user/accessTokens/{id}']!.delete!.operationId).to.equal(
      'deleteAccessToken'
    )
    expect(swagger.definitions.DevicePayload!.properties!.status!.enum).to.eql([
      'Disconnected'
    ])
  })
})
