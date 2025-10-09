import { Editor } from '@monaco-editor/react'
import { useRef } from 'react'

type ASLEditorProps = { value: any; setValue?: any }
export const ASLEditor: React.FC<ASLEditorProps> = ({ value, setValue }) => {
  const editorRef = useRef(null)

  function handleEditorChange(value: any, _event: any) {
    // here is the current value
    setValue(value)
  }

  function handleEditorDidMount(editor: any, _monaco: any) {
    editorRef.current = editor
  }

  function handleEditorWillMount(_monaco: any) {
    // intentionally left blank
  }

  function handleEditorValidation(_markers: any) {
    // model markers - no logging
  }

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  return (
    <>
      <Editor
        language="json"
        defaultValue={value}
        value={value}
        theme={isDark ? 'vs-dark' : 'light'}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        beforeMount={handleEditorWillMount}
        onValidate={handleEditorValidation}
        options={{ lineNumbers: 'on' }}
      />
    </>
  )
}
