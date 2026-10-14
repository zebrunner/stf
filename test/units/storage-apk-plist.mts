import fs from 'fs'
import os from 'os'
import path from 'path'

import {expect} from 'chai'

import {parsePlistXml} from '../../lib/units/storage/plugins/apk/task/parser.js'
import manifestTask from '../../lib/units/storage/plugins/apk/task/manifest.js'

describe('storage apk plist parser', function() {
  it('should parse nested Info.plist data', function() {
    var plist = parsePlistXml(`<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
        "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
        <dict>
          <key>CFBundleIdentifier</key>
          <string>com.example.app</string>
          <key>CFBundleDisplayName</key>
          <string>Example &amp; Test</string>
          <key>UIDeviceFamily</key>
          <array>
            <integer>1</integer>
            <integer>2</integer>
          </array>
          <key>MinimumOSVersion</key>
          <real>17.5</real>
          <key>UISupportsDocumentBrowser</key>
          <true/>
          <key>Nested</key>
          <dict>
            <key>Enabled</key>
            <false/>
          </dict>
        </dict>
      </plist>`)

    expect(plist).to.deep.equal({
      CFBundleIdentifier: 'com.example.app'
    , CFBundleDisplayName: 'Example & Test'
    , UIDeviceFamily: [1, 2]
    , MinimumOSVersion: 17.5
    , UISupportsDocumentBrowser: true
    , Nested: {
        Enabled: false
      }
    })
  })

  it('should return an empty object when no plist dictionary exists', function() {
    expect(parsePlistXml('not a plist')).to.deep.equal({})
  })
})

describe('storage apk manifest task', function() {
  it('should read the app Info.plist of an .ipa, not an embedded framework one', function() {
    var source = path.join(import.meta.dirname, '../fixt/ios-with-framework.ipa')
    var copy = path.join(os.tmpdir(), 'stf-manifest-' + process.pid + '.ipa')
    fs.copyFileSync(source, copy)
    return manifestTask({path: copy})
      .then(function(manifest) {
        expect(manifest).to.have.property('CFBundleIdentifier', 'com.example.app')
      })
      .finally(function() {
        fs.rmSync(copy, {force: true})
      })
  })
})
