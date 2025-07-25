import { useState, useMemo } from 'react'
import { CustomAgent } from '@/types/agent-chat'

export const useAgentFilter = (agents: CustomAgent[]) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>()
    agents.forEach((agent) => {
      agent.tags?.forEach((tag) => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }, [agents])

  const filteredAgents = useMemo(
    () =>
      [...agents]
        .filter((agent) => {
          // Don't display special agents used on other pages
          const excludedAgentIds = [
            'reactGeneratorAgent',
            'vueGeneratorAgent',
            'svelteGeneratorAgent',
            // 'diagramGeneratorAgent',
            'softwareArchitectureAgent',
            'businessProcessAgent'
          ]
          return !excludedAgentIds.includes(agent.id)
        })
        .filter((agent) => {
          const nameMatch = agent.name.toLowerCase().includes(searchQuery.toLowerCase())
          const tagMatch =
            selectedTags.length === 0 || selectedTags.every((tag) => agent.tags?.includes(tag))
          return nameMatch && tagMatch
        }),
    [agents, searchQuery, selectedTags]
  )

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  return {
    searchQuery,
    setSearchQuery,
    selectedTags,
    availableTags,
    filteredAgents,
    toggleTag
  }
}
