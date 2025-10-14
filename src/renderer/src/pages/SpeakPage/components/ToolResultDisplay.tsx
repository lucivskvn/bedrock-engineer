import React from 'react'
import { Accordion, AccordionContent, AccordionPanel, AccordionTitle } from 'flowbite-react'
import { FaCheck } from 'react-icons/fa'
import { ToolExecutionState } from '../hooks/useSpeakChat'

interface ToolResultDisplayProps {
  toolExecutionState: ToolExecutionState
}

export const ToolResultDisplay: React.FC<ToolResultDisplayProps> = ({ toolExecutionState }) => {
  if (!toolExecutionState.lastResult) {
    return null
  }

  const { lastResult } = toolExecutionState

  return (
    <div className="mb-4">
      <Accordion className="w-full" collapseAll>
        <AccordionPanel>
          <AccordionTitle>
            <div className="flex gap-4 items-center">
              <span className="rounded-md">
                <FaCheck className="size-6 text-green-500" />
              </span>
              <div className="flex gap-2">
                <span>完了:</span>
                <span className="rounded-md px-2 py-1 bg-green-500 text-white text-xs">
                  {lastResult.toolName}
                </span>
              </div>
            </div>
          </AccordionTitle>
          <AccordionContent className="w-full">
            <div className="text-xs bg-white dark:bg-gray-800 p-2 rounded border">
              <pre className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                {JSON.stringify(lastResult.result, null, 2)}
              </pre>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </div>
  )
}
