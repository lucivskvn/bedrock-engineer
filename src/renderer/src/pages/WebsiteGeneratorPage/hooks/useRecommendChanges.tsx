import { rendererLogger as log } from '@renderer/lib/logger';
import useSetting from '@renderer/hooks/useSetting'
import { converse } from '@renderer/lib/api'
import { getLightProcessingModelId } from '@renderer/lib/modelSelection'
import prompts from '@renderer/prompts/prompts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export const useRecommendChanges = () => {
  const {
    t,
    i18n: { language }
  } = useTranslation()
  const examplePrompts = [
    {
      title: t('ecSiteTitle'),
      value: t('ecSiteValue')
    },
    {
      title: t('ecSiteAdminTitle'),
      value: t('ecSiteAdminValue')
    },
    {
      title: t('healthFitnessSiteTitle'),
      value: t('healthFitnessSiteValue')
    },
    {
      title: t('drawingGraphTitle'),
      value: t('drawingGraphValue')
    },
    {
      title: t('todoAppTitle'),
      value: t('todoAppValue')
    },
    {
      title: t('codeTransformTitle'),
      value: t('codeTransformValue')
    }
  ]
  const [recommendChanges, setRecommendChanges] = useState(examplePrompts)
  const [recommendLoading, setRecommendLoading] = useState(false)
  const { currentLLM: llm, lightProcessingModel } = useSetting()

  const getRecommendChanges = async (websiteCode: string) => {
    let retry = 0
    if (retry > 3) {
      return
    }
    setRecommendLoading(true)
    const result = await converse({
      modelId: getLightProcessingModelId(llm, lightProcessingModel),
      system: [{ text: t(prompts.WebsiteGenerator.recommend.system, { language }) }],
      messages: [{ role: 'user', content: [{ text: websiteCode }] }],
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0.5
      }
    })

    const recommendChanges = result.output.message?.content[0]?.text

    try {
      if (recommendChanges) {
        const json = JSON.parse(recommendChanges)
        setRecommendChanges(json)
        setRecommendLoading(false)
      }
    } catch (e) {
      log.debug('Error parsing recommend changes', { error: e })
      retry += 1
      return getRecommendChanges(websiteCode)
    }
  }

  const refleshRecommendChanges = () => {
    setRecommendChanges(examplePrompts)
  }

  return {
    recommendChanges,
    setRecommendChanges,
    recommendLoading,
    getRecommendChanges,
    refleshRecommendChanges
  }
}
