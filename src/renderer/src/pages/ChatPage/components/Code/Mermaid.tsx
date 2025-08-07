import { rendererLogger as log } from '@renderer/lib/logger';
import mermaid from 'mermaid'
import React from 'react'
import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { IoIosClose } from 'react-icons/io'
import { VscZoomIn, VscZoomOut, VscScreenFull } from 'react-icons/vsc'

type Props = {
  code: string
  handler?: any
  onRenderComplete?: () => void
}

mermaid.initialize({
  // syntax error が dom node に勝手に追加されないようにする
  // https://github.com/mermaid-js/mermaid/pull/4359
  suppressErrorRendering: true,
  securityLevel: 'loose', // SVGのレンダリングを許可
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
  fontFamily: 'monospace', // フォントファミリーを指定
  fontSize: 16, // フォントサイズを指定
  htmlLabels: true // HTMLラベルを許可
})

export const MermaidCore: React.FC<Props> = (props) => {
  const { code, onRenderComplete } = props
  const [svgContent, setSvgContent] = useState<string>('')

  const render = useCallback(async () => {
    if (code) {
      try {
        // 一意な ID を指定する必要あり
        const { svg } = await mermaid.render(`m${crypto.randomUUID()}`, code)
        // SVG文字列をパースしてDOMオブジェクトに変換
        const parser = new DOMParser()
        const doc = parser.parseFromString(svg, 'image/svg+xml')
        const svgElement = doc.querySelector('svg')

        if (svgElement) {
          // SVG要素に必要な属性を設定
          svgElement.setAttribute('width', '100%')
          svgElement.setAttribute('height', '100%')
          setSvgContent(svgElement.outerHTML)
          // レンダリング成功時にコールバックを呼び出し
          onRenderComplete?.()
        }
      } catch (error) {
        log.error('Mermaid render error', { error })
        setSvgContent('<div>Invalid syntax</div>')
        // エラー時はコールバックを呼び出さない
      }
    }
  }, [code, onRenderComplete])

  useEffect(() => {
    render()
  }, [code, render])

  return code ? (
    <div
      onClick={props.handler}
      className="h-full w-full cursor-pointer bg-gray-100 dark:bg-gray-900 flex justify-center items-center content-center hover:shadow-lg duration-700 rounded-lg p-8"
    >
      <div
        className="w-full h-full flex justify-center aligh-center items-center"
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  ) : null
}

export const Mermaid = ({
  chart,
  onRenderComplete
}: {
  chart: string
  onRenderComplete?: () => void
}) => {
  const [zoom, setZoom] = useState(false)
  const [fullscreenZoomLevel, setFullscreenZoomLevel] = useState(1)

  // on click esc key
  useEffect(() => {
    const handleEsc = (event: any) => {
      if (event.keyCode === 27) {
        setZoom(false)
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('keydown', handleEsc)
    }
  }, [])

  // Reset zoom when opening fullscreen
  useEffect(() => {
    if (zoom) {
      setFullscreenZoomLevel(1)
    }
  }, [zoom])

  const fullscreenZoomIn = () => {
    setFullscreenZoomLevel((prev) => Math.min(prev + 0.25, 3))
  }

  const fullscreenZoomOut = () => {
    setFullscreenZoomLevel((prev) => Math.max(prev - 0.25, 0.5))
  }

  const fullscreenResetZoom = () => {
    setFullscreenZoomLevel(1)
  }

  return (
    <>
      <MermaidCore handler={() => setZoom(true)} code={chart} onRenderComplete={onRenderComplete} />

      {zoom &&
        createPortal(
          <div
            className="fixed inset-0 bg-black bg-opacity-75"
            style={{ zIndex: 2147483647 }}
            onClick={() => {
              setZoom(false)
            }}
          >
            {/* Top controls bar */}
            <div
              className="absolute top-4 left-1/2 transform -translate-x-1/2 flex items-center space-x-2 bg-gray-800 bg-opacity-75 rounded-lg px-4 py-2"
              style={{ zIndex: 2147483647 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Zoom controls */}
              <button
                onClick={fullscreenZoomOut}
                disabled={fullscreenZoomLevel <= 0.5}
                className="p-1 rounded text-white hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Zoom Out"
              >
                <VscZoomOut size={16} />
              </button>
              <span className="text-white text-sm min-w-[3rem] text-center">
                {Math.round(fullscreenZoomLevel * 100)}%
              </span>
              <button
                onClick={fullscreenZoomIn}
                disabled={fullscreenZoomLevel >= 3}
                className="p-1 rounded text-white hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Zoom In"
              >
                <VscZoomIn size={16} />
              </button>
              <button
                onClick={fullscreenResetZoom}
                className="p-1 rounded text-white hover:bg-gray-600"
                title="Reset Zoom"
              >
                <VscScreenFull size={16} />
              </button>
            </div>

            {/* Close button */}
            <div
              className="absolute top-4 right-4 p-2"
              style={{ zIndex: 2147483647 }}
              onClick={() => setZoom(false)}
            >
              <IoIosClose className="text-white w-8 h-8 hover:bg-gray-700 rounded cursor-pointer" />
            </div>

            {/* Scrollable content area */}
            <div
              className="w-full h-full overflow-auto flex items-center justify-center p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  transform: `scale(${fullscreenZoomLevel})`,
                  transformOrigin: 'center center',
                  minWidth: `${100 * fullscreenZoomLevel}%`,
                  minHeight: `${100 * fullscreenZoomLevel}%`
                }}
                className="transition-transform duration-200 flex items-center justify-center"
              >
                <MermaidCore code={chart} />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
