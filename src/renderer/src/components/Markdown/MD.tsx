import Markdown, { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import style from './styles.module.css'
import { useMemo } from 'react'
import LocalImage from '../LocalImage'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you

type MDProps = {
  children: string | null | undefined
}

type AnchorProps = {
  href?: string
  children?: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
}

type ImgProps = {
  src?: string
  alt?: string
  className?: string
}

const MD = (props: MDProps) => {
  const components: Partial<Components> = useMemo(() => {
    return {
      a: (props: AnchorProps) => (
        <a
          {...props}
          onClick={(e) => {
            e.preventDefault()
            if (props.href) {
              open(props.href)
            }
          }}
          style={{ cursor: 'pointer' }}
        />
      ),
      img: ({ src, alt, ...props }: ImgProps) => {
        if (src?.startsWith('/')) {
          return <LocalImage src={src} alt={alt || ''} {...props} />
        }
        return <img src={src} alt={alt} {...props} />
      }
    }
  }, [])

  return (
    <div className={style.reactMarkDown}>
      <Markdown remarkPlugins={[[remarkGfm, { singleTilde: false }], [remarkMath]]} rehypePlugins={[rehypeKatex]} components={components}>
        {props.children}
      </Markdown>
    </div>
  )
}

export default MD
