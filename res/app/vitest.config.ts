import path from 'node:path'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  root: __dirname
  , cacheDir: path.resolve(__dirname, '../../node_modules/.vite')
  , resolve: {
    alias: [
      {find: /^.*\/i18n-catalogs$/, replacement: path.resolve(__dirname, 'src/test/i18n-catalogs.ts')}
      , {find: '@', replacement: path.resolve(__dirname, 'src')}
    ]
  }
  , test: {
    environment: 'jsdom'
    // Fork (Zebrunner): each file in a VM context of a reused worker thread instead of a new
    // worker process: the same results, 3x faster (doc/ci.md#the-component-tier)
    , pool: 'vmThreads'
    , include: ['src/**/*.test.{ts,tsx}']
  }
})
