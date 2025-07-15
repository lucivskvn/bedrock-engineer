import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import tailwindcss from 'tailwindcss'

export default defineConfig(({ command }) => {
  const isCliBuild = command === 'build' && process.argv.includes('--out-dir')

  if (isCliBuild) {
    return {
      main: {
        entry: 'src/cli/index.ts',
        plugins: [externalizeDepsPlugin()],
        build: {
          outDir: 'out/cli',
          lib: {
            entry: 'src/cli/index.ts',
            formats: ['cjs'],
            fileName: 'index'
          },
          rollupOptions: {
            external: ['electron']
          }
        }
      }
    }
  }

  return {
    main: {
      plugins: [externalizeDepsPlugin()]
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@': resolve('src'),
          '@common': resolve('src/common')
        }
      },
      plugins: [
        react(),
        svgr({
          svgrOptions: {
            exportType: 'default',
            ref: true,
            svgo: false,
            titleProp: true
          },
          include: '**/*.svg'
        })
      ],
      css: {
        postcss: {
          plugins: [tailwindcss() as any]
        }
      }
    }
  }
})
