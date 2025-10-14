import React, { useState } from 'react'
import MD from '@renderer/components/Markdown/MD'
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'flowbite-react'
import { useTranslation } from 'react-i18next'

interface SystemPromptModalProps {
  isOpen: boolean
  onClose: () => void
  systemPrompt: string
  onSystemPromptChange: (prompt: string) => void
  isConnected: boolean
}

export const useSystemPromptModal = () => {
  const [show, setShow] = useState(false)
  const handleOpen = () => {
    setShow(true)
  }
  const handleClose = () => {
    setShow(false)
  }

  return {
    show: show,
    handleOpen: handleOpen,
    handleClose: handleClose,
    SystemPromptModal: SystemPromptModal
  }
}

const SystemPromptModal = React.memo(
  ({
    isOpen,
    onClose,
    systemPrompt,
    onSystemPromptChange,
    isConnected
  }: SystemPromptModalProps) => {
    const { t } = useTranslation()
    const [editedPrompt, setEditedPrompt] = useState(systemPrompt)

    React.useEffect(() => {
      setEditedPrompt(systemPrompt)
    }, [systemPrompt])

    const handleSave = () => {
      onSystemPromptChange(editedPrompt)
      onClose()
    }

    if (!isOpen) return null

    return (
      <Modal dismissible show={isOpen} onClose={onClose} size="7xl">
        <ModalHeader>SYSTEM PROMPT</ModalHeader>
        <ModalBody className="dark:text-white">
          {isConnected ? (
            <div>
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                {t('Disconnect to edit the system prompt')}. {t('Current prompt')}:
              </p>
              <MD>{systemPrompt}</MD>
            </div>
          ) : (
            <div>
              <textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                className="w-full h-64 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder={t('Enter system prompt for the AI assistant...')}
              />
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t('This prompt will be sent when you connect to start the conversation')}
              </p>
            </div>
          )}
        </ModalBody>
        {!isConnected && (
          <ModalFooter>
            <div className="flex justify-end space-x-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {t('Save')}
              </button>
            </div>
          </ModalFooter>
        )}
      </Modal>
    )
  }
)

SystemPromptModal.displayName = 'SystemPromptModal'
