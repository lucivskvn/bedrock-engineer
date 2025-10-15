import { rendererLogger as log } from '@renderer/lib/logger';
import { StopReason } from '@aws-sdk/client-bedrock-runtime'
import { streamChatCompletion } from '@renderer/lib/api'
import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { extractErrorMetadata, truncateForLogging } from '@renderer/lib/logging/errorMetadata'

type UseChatProps = {
  systemPrompt: string
  modelId: string
}
export const useChat = (props: UseChatProps) => {
  const [messages, setMessages] = useState<{ role: string; content: { text: string }[] }[]>([])
  const [loading, setLoading] = useState(false)
  const [lastText, setLatestText] = useState('')
  const [stopReason, setStopReason] = useState<StopReason>()
  const { t } = useTranslation()

  const handleSubmit = useCallback(
    async (input: string, messages) => {
      const normalizedInput = input.trim()
      if (!normalizedInput) {
        toast.error(t('prompt required'))
        return
      }

      const userMessage = { role: 'user', content: [{ text: normalizedInput }] }
      const initialMessages = [...messages, userMessage]
      setMessages(initialMessages)

      setLoading(true)

      let accumulatedResponse = ''

      try {
        const generator = streamChatCompletion({
          messages: initialMessages,
          modelId: props.modelId,
          system: [
            {
              text: props.systemPrompt
            }
          ]
        })

        for await (const json of generator) {
          if (json.contentBlockDelta) {
            const text = json.contentBlockDelta.delta?.text
            if (text) {
              accumulatedResponse += text
              setMessages([...initialMessages, { role: 'assistant', content: [{ text: accumulatedResponse }] }])
              setLatestText(accumulatedResponse)
            }
          }

          if (json.messageStop) {
            log.debug('message stop reason', { stopReason: json.messageStop.stopReason })
            setStopReason(json.messageStop.stopReason)
          }
        }
      } catch (error: unknown) {
        const metadata = extractErrorMetadata(error)
        log.error('Chat streaming failed', {
          ...metadata,
          modelId: props.modelId,
          userMessagePreview: truncateForLogging(normalizedInput, 100),
          systemPromptPreview: truncateForLogging(props.systemPrompt, 100)
        })
        toast.error(t('request error'))
        setLatestText('')
        setStopReason(undefined)
        setMessages([
          ...initialMessages,
          {
            role: 'assistant',
            content: [
              {
                text: t('assistant error response')
              }
            ]
          }
        ])
        return
      } finally {
        setLoading(false)
      }

      setMessages([
        ...initialMessages,
        { role: 'assistant', content: [{ text: accumulatedResponse }] }
      ])
    },
    [props.modelId, props.systemPrompt, t]
  )

  const initChat = () => {
    setMessages([])
    setLatestText('')
  }

  return { messages, handleSubmit, loading, initChat, lastText, setLoading, stopReason }
}
