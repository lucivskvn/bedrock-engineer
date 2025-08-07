import { rendererLogger as log } from '@renderer/lib/logger';
export interface ChatMessage {
  role: string
  message: string
  endOfResponse?: boolean
  translation?: {
    translatedText: string
    sourceLanguage: string
    targetLanguage: string
    isTranslating?: boolean
    error?: string | null
  }
}

export interface ChatHistory {
  history: ChatMessage[]
}

export interface ChatEndMarker {
  endOfConversation: boolean
}

export type ChatHistoryItem = ChatMessage | ChatEndMarker

export interface ChatRef {
  current: ChatHistory
}

export type SetChatFunction = (chat: ChatHistory) => void

export class ChatHistoryManager {
  private static instance: ChatHistoryManager | null = null

  private chatRef!: ChatRef
  private setChat!: SetChatFunction

  constructor(chatRef: ChatRef, setChat: SetChatFunction) {
    if (ChatHistoryManager.instance) {
      return ChatHistoryManager.instance
    }

    this.chatRef = chatRef
    this.setChat = setChat
    ChatHistoryManager.instance = this
  }

  static getInstance(chatRef?: ChatRef, setChat?: SetChatFunction): ChatHistoryManager {
    if (!ChatHistoryManager.instance) {
      if (!chatRef || !setChat) {
        throw new Error(
          'ChatHistoryManager: chatRef and setChat are required for first initialization'
        )
      }
      ChatHistoryManager.instance = new ChatHistoryManager(chatRef, setChat)
    } else if (chatRef && setChat) {
      // Update references if they're provided
      ChatHistoryManager.instance.chatRef = chatRef
      ChatHistoryManager.instance.setChat = setChat
    }
    return ChatHistoryManager.instance
  }

  addTextMessage(content: { role: string; message: string }): void {
    if (!this.chatRef || !this.setChat) {
      log.error('ChatHistoryManager: chatRef or setChat is not initialized')
      return
    }

    const history = this.chatRef.current?.history || []
    log.debug('[ChatHistoryManager] Current history length:', history.length)
    log.debug('[ChatHistoryManager] Adding message:', content)

    const updatedChatHistory = [...history]
    const lastTurn = updatedChatHistory[updatedChatHistory.length - 1]

    if (lastTurn !== undefined && lastTurn.role === content.role) {
      // Same role, append to the last turn
      updatedChatHistory[updatedChatHistory.length - 1] = {
        ...content,
        message: lastTurn.message + ' ' + content.message
      }
      log.debug('[ChatHistoryManager] Appended to existing message')
    } else {
      // Different role, add a new turn
      updatedChatHistory.push({
        role: content.role,
        message: content.message
      })
      log.debug('[ChatHistoryManager] Added new message')
    }

    log.debug('[ChatHistoryManager] Updated history length:', updatedChatHistory.length)
    this.setChat({
      history: updatedChatHistory
    })
  }

  endTurn(): void {
    if (!this.chatRef || !this.setChat) {
      log.error('ChatHistoryManager: chatRef or setChat is not initialized')
      return
    }

    const history = this.chatRef.current?.history || []
    const updatedChatHistory = history.map((item) => {
      return {
        ...item,
        endOfResponse: true
      }
    })

    this.setChat({
      history: updatedChatHistory
    })
  }

  endConversation(): void {
    if (!this.chatRef || !this.setChat) {
      log.error('ChatHistoryManager: chatRef or setChat is not initialized')
      return
    }

    const history = this.chatRef.current?.history || []
    const updatedChatHistory = history.map((item) => {
      return {
        ...item,
        endOfResponse: true
      }
    })

    updatedChatHistory.push({
      role: 'SYSTEM',
      message: 'Conversation ended',
      endOfResponse: true
    })

    this.setChat({
      history: updatedChatHistory
    })
  }

  clearHistory(): void {
    if (!this.setChat) {
      log.error('ChatHistoryManager: setChat is not initialized')
      return
    }

    this.setChat({
      history: []
    })
  }
}

export default ChatHistoryManager
