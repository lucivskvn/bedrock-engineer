import { rendererLogger as log } from '@renderer/lib/logger';
import React, { useMemo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettings } from '@renderer/contexts/SettingsContext'
import { Label, Select } from 'flowbite-react'
import { BedrockSupportRegion } from '@/types/llm'

export const GenerateImageSettingForm: React.FC = () => {
  const { t } = useTranslation()
  const { generateImageModel, setGenerateImageModel, awsRegion } = useSettings()
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([])

  // リージョンが変更されたときに利用可能なモデルを取得
  useEffect(() => {
    const fetchModels = async () => {
      if (awsRegion && window.api?.bedrock?.getImageGenerationModelsForRegion) {
        try {
          const models = await window.api.bedrock.getImageGenerationModelsForRegion(
            awsRegion as BedrockSupportRegion
          )
          setAvailableModels(models)

          // 現在選択されているモデルが利用可能なモデルに含まれていない場合、最初のモデルを選択
          const modelIds = models.map((m) => m.id)
          if (generateImageModel && !modelIds.includes(generateImageModel) && models.length > 0) {
            setGenerateImageModel(models[0].id)
          }
        } catch (error) {
          log.error('Failed to fetch image generation models', { error })
          setAvailableModels([])
        }
      }
    }

    fetchModels()
  }, [awsRegion, generateImageModel, setGenerateImageModel])

  // モデルをプロバイダーごとにソート（すでにソート済みのものが返ってくるが念のため）
  const sortedModels = useMemo(() => {
    return [...availableModels]
  }, [availableModels])

  // モデル変更のハンドラー
  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setGenerateImageModel(e.target.value)
  }

  return (
    <div className="prose dark:prose-invert max-w-none w-full">
      {/* ツールの説明 */}
      <div className="mb-6 w-full">
        <p className="mb-4 text-gray-700 dark:text-gray-300">
          {t(
            'tool info.generateImage.description',
            'The generateImage tool uses AI image generation capabilities to create images from text descriptions. It helps the AI assistant generate visual content based on textual prompts and save them to specified locations.'
          )}
        </p>
      </div>

      {/* 設定フォーム */}
      <div className="flex flex-col gap-2 p-4 border border-gray-200 dark:border-gray-700 rounded-md mb-6 w-full">
        <div className="mb-4 w-full">
          <Label htmlFor="generateImageModel">{t('Image Generation Model')}</Label>
          {sortedModels.length > 0 ? (
            <Select
              id="generateImageModel"
              value={generateImageModel}
              onChange={handleModelChange}
              className="mt-2 w-full"
            >
              {sortedModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </Select>
          ) : (
            <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 dark:border dark:border-red-700 rounded-md">
              <p className="text-sm text-red-700 dark:text-red-300">
                {t(
                  'No image generation models available in the selected region',
                  'No image generation models are available in the selected AWS region. Please select a different region that supports image generation models.'
                )}
              </p>
            </div>
          )}
        </div>

        {/* 使用上の注意 */}
        <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 dark:border dark:border-yellow-700 rounded-md">
          <h5 className="font-medium mb-2 dark:text-yellow-300">{t('Important Notes')}</h5>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>• {t('Model availability may vary by AWS region')}</li>
            <li>• {t('Different models support different aspect ratios and features')}</li>
            <li>• {t('Image generation costs vary by model and output resolution')}</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
