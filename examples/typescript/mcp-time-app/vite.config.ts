import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const input = process.env.INPUT
if (!input) {
  throw new Error('INPUT environment variable is not set')
}

function stripZodEvalCheck(): Plugin {
  return {
    name: 'strip-zod-eval-check',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/zod/') || !id.endsWith('/v4/core/util.js')) {
        return null
      }

      const nextCode = code.replace(/new F\(""\);\s*return true;/, 'return false;')
      if (nextCode === code) {
        return null
      }

      return {
        code: nextCode,
        map: null,
      }
    },
  }
}

export default defineConfig({
  plugins: [stripZodEvalCheck(), viteSingleFile()],
  build: {
    rollupOptions: {
      input,
    },
    outDir: 'dist',
    emptyOutDir: false,
  },
})
