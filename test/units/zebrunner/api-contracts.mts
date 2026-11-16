import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'

import {expect} from 'chai'

interface Operation {
  operationId?: string
  security?: unknown
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

interface SwayRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

interface SwayApi {
  validate(): {errors: unknown[]}
  getOperation(req: SwayRequest): {validateRequest(req: SwayRequest): {errors: unknown[]}}
}

var require = createRequire(import.meta.url)
// js-yaml comes with the swagger middleware of the API unit, which loads the same file
var yaml = require('js-yaml') as {load(text: string): unknown}
// the validator of the swagger middleware: swagger_validator of lib/units/api/config/default.yaml
var sway = require('autodesk-forks-sway') as {
  create(options: {definition: string}): Promise<SwayApi>
}
var swaggerFile = new URL('../../../lib/units/api/swagger/api_v1.yaml', import.meta.url)

describe('zebrunner: API contract', function() {
  var swagger: SwaggerDoc

  before(async function() {
    swagger = yaml.load(await readFile(swaggerFile, 'utf8')) as SwaggerDoc
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

  it('should need an access token for every operation but the node ones', function() {
    // the enrolled nodes authenticate with their invite or node token, checked by the operations themselves
    var nodeOperations = ['enrollNode', 'getNodeSelf', 'getNodeKeys', 'checkNodeToken']
    var open = Object.values(swagger.paths).flatMap(function(path) {
      return [path.get, path.put, path.post, path.delete]
    }).filter(function(operation): operation is Operation {
      return Boolean(operation && operation.operationId && !operation.security)
    }).map(function(operation) {
      return operation.operationId
    })
    expect(open).to.have.members(nodeOperations)
  })

  it('should document fork access-token and device-status contracts', function() {
    expect(swagger.paths['/user/fullAccessTokens']!.get!.operationId).to.equal('getAccessTokens')
    expect(swagger.paths['/user/accessTokens/{id}']!.delete!.operationId).to.equal(
      'deleteAccessToken'
    )
  })

  it('should answer the type of a device as {type}', function() {
    expect(swagger.definitions.TypeResponse!.required).to.eql(['type'])
    expect(swagger.definitions.TypeResponse!.properties!.type!.enum).to.eql(['iPhone', 'Apple TV'])
  })

  describe('PUT /devices/{serial} request validation', function() {
    var api: SwayApi

    before(async function() {
      api = await sway.create({definition: fileURLToPath(swaggerFile)})
      expect(api.validate().errors).to.eql([])
    })

    // errors <body>: the errors of the validator for the body of PUT /devices/{serial}
    function errors(body: unknown) {
      var req = {
        method: 'PUT'
      , url: '/api/v1/devices/serial'
      , headers: {'content-type': 'application/json'}
      , body: body
      }
      return api.getOperation(req).validateRequest(req).errors
    }

    var statuses = [
      'disconnected', 'Disconnected', 'offline', 'available', 'AVAILABLE', 'busy', 'unauthorized'
    , 'preparing', 'unhealthy'
    ]

    statuses.forEach(function(status) {
      it('should accept the status ' + status + ', bare and wrapped in device', function() {
        var body = {status: status, owner: {name: 'Jane', email: 'jane@example.com'}}
        expect(errors(body)).to.eql([])
        expect(errors({device: body})).to.eql([])
      })
    })

    it('should accept a note', function() {
      expect(errors({note: 'n'})).to.eql([])
      expect(errors({device: {note: 'n'}})).to.eql([])
    })

    it('should refuse a status or an owner of another type', function() {
      expect(errors({status: 7})).to.not.eql([])
      expect(errors({status: 'busy', owner: 'Jane'})).to.not.eql([])
      expect(errors({device: {status: 'busy', owner: 'Jane'}})).to.not.eql([])
    })
  })
})
