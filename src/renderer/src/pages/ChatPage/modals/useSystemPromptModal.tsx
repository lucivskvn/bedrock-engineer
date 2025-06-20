import React, { useState } from 'react'
import MD from '@renderer/components/Markdown/MD'
import { Modal, ModalBody, ModalHeader } from 'flowbite-react';

interface SystemPromptModalProps {
  isOpen: boolean
  onClose: () => void
  systemPrompt: string
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
  ({ isOpen, onClose, systemPrompt }: SystemPromptModalProps) => {
    if (!isOpen) return null

    return (
      <Modal dismissible show={isOpen} onClose={onClose} size="7xl">
        <ModalHeader>SYSTEM PROMPT</ModalHeader>
        <ModalBody className="dark:text-white">
          <MD>{systemPrompt}</MD>
        </ModalBody>
      </Modal>
    );
  }
)

SystemPromptModal.displayName = 'SystemPromptModal'
