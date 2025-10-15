import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

type ElectronViteConfig = {
  main: { plugins: unknown[] }
  preload: { plugins: unknown[] }
  renderer: {
    resolve: { alias: Record<string, string> }
    plugins: unknown[]
    css?: {
      postcss?: {
        plugins?: unknown[]
      }
    }
  }
}

async function resolveElectronVitePlugins() {
  const [{ externalizeDepsPlugin }, svgrModule, tailwindModule] = await Promise.all([
    // eslint-disable-next-line no-restricted-syntax -- electron-vite publishes ESM-only entry points
    import('electron-vite'),
    // eslint-disable-next-line no-restricted-syntax -- vite-plugin-svgr exports are ESM-only
    import('vite-plugin-svgr'),
    // eslint-disable-next-line no-restricted-syntax -- tailwindcss v4 ships as a pure ESM package
    import('tailwindcss')
  ])

  const svgr = svgrModule.default ?? svgrModule
  const tailwindcss = tailwindModule.default ?? tailwindModule

  return {
    externalizeDepsPlugin,
    svgr,
    tailwindcss
  }
}

export default async function defineElectronConfig() {
  const { externalizeDepsPlugin, svgr, tailwindcss } = await resolveElectronVitePlugins()

  const config: ElectronViteConfig = {
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
        react({
          jsxRuntime: 'automatic'
        }),
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
          plugins: [tailwindcss()] as unknown[]
        }
      }
    }
  }

  return config
}
