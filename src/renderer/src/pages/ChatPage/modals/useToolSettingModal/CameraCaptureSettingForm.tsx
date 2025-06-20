import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Label, Select, Button, ToggleSwitch } from 'flowbite-react'
import { ArrowPathIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import { useSettings } from '@renderer/contexts/SettingsContext'
import { CameraConfig } from '@/types/agent-chat'
import { CameraDeviceInfo, enumerateCameraDevices } from '@renderer/lib/camera-utils'

// Type definition for camera device information (maintaining compatibility with existing CameraConfig)
// Translation: カメラデバイス情報の型定義（既存のCameraConfigと互換性を保つ）
interface CameraInfo extends CameraDeviceInfo {
  thumbnail?: string // base64 image data (optional)
  // Translation: base64画像データ（オプショナル）
}

export const CameraCaptureSettingForm: React.FC = () => {
  const { t } = useTranslation()
  const {
    recognizeImageModel,
    setRecognizeImageModel,
    availableModels,
    selectedAgentId,
    getAgentAllowedCameras,
    updateAgentAllowedCameras
  } = useSettings()

  // State related to cameras
  // Translation: カメラ関連の状態
  const [availableCameras, setAvailableCameras] = useState<CameraInfo[]>([])
  const [allowedCameras, setAllowedCameras] = useState<CameraConfig[]>([])
  const [isLoadingCameras, setIsLoadingCameras] = useState(false)
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(new Set())

  // State of the preview window
  // Translation: プレビューウィンドウの状態
  const [previewEnabled, setPreviewEnabled] = useState(false)
  const [previewSize, setPreviewSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [previewOpacity, setPreviewOpacity] = useState(0.9)
  const [previewPosition, setPreviewPosition] = useState<
    'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  >('bottom-right')
  const [previewStatus, setPreviewStatus] = useState<{ isActive: boolean }>({ isActive: false })

  // Filter for Vision-capable models (Claude and Nova series)
  // Translation: Vision-capable モデルをフィルタリング（Claude と Nova シリーズ）
  const visionCapableModels = useMemo(() => {
    return availableModels
      .filter(
        (model) =>
          model.modelId.includes('anthropic.claude') || model.modelId.includes('amazon.nova')
      )
      .sort((a, b) => a.modelName.localeCompare(b.modelName))
  }, [availableModels])

  // Load allowed camera settings for the agent
  // Translation: エージェントの許可カメラ設定を読み込み
  useEffect(() => {
    if (selectedAgentId) {
      const cameras = getAgentAllowedCameras(selectedAgentId)
      setAllowedCameras(cameras)
    }
  }, [selectedAgentId, getAgentAllowedCameras])

  // Image load error handler (React state-based)
  // Translation: 画像読み込みエラーハンドラー（React状態ベース）
  const handleImageError = useCallback((cameraId: string) => {
    setImageLoadErrors((prev) => new Set([...prev, cameraId]))
  }, [])

  // Get list of available cameras
  // Translation: 利用可能なカメラ一覧を取得
  const fetchAvailableCameras = useCallback(async () => {
    setIsLoadingCameras(true)
    setImageLoadErrors(new Set()) // Reset error state
    // Translation: エラー状態をリセット
    try {
      const cameras = await enumerateCameraDevices()
      setAvailableCameras(cameras)
    } catch (error) {
      console.error('Failed to fetch available cameras:', error)
      setAvailableCameras([])
    } finally {
      setIsLoadingCameras(false)
    }
  }, [])

  // Check if a camera is allowed
  // Translation: カメラが許可されているかチェック
  const isCameraAllowed = (camera: CameraInfo): boolean => {
    return allowedCameras.some((allowed) => allowed.id === camera.id)
  }

  // Toggle camera permission (allow/disallow)
  // Translation: カメラの許可/非許可を切り替え
  const handleCameraToggle = (camera: CameraInfo, enabled: boolean) => {
    if (!selectedAgentId) return

    let updatedCameras: CameraConfig[]

    if (enabled) {
      // Add camera to the allowed list
      // Translation: カメラを許可リストに追加
      const newCamera: CameraConfig = {
        id: camera.id,
        name: camera.name,
        enabled: true
      }
      updatedCameras = [...allowedCameras.filter((c) => c.id !== camera.id), newCamera]
    } else {
      // Remove camera from the allowed list
      // Translation: カメラを許可リストから削除
      updatedCameras = allowedCameras.filter((c) => c.id !== camera.id)
    }

    setAllowedCameras(updatedCameras)
    updateAgentAllowedCameras(selectedAgentId, updatedCameras)
  }

  // Get the state of the preview window
  // Translation: プレビューウィンドウの状態を取得
  const fetchPreviewStatus = useCallback(async () => {
    if (window.api?.camera?.getPreviewStatus) {
      try {
        const status = await window.api.camera.getPreviewStatus()
        setPreviewStatus(status)
        setPreviewEnabled(status.isActive)

        if (status.options) {
          setPreviewSize(status.options.size || 'medium')
          setPreviewOpacity(status.options.opacity || 0.9)
          setPreviewPosition(status.options.position || 'bottom-right')
        }
      } catch (error) {
        console.error('Failed to get preview status:', error)
      }
    }
  }, [])

  // Toggle the visibility of the preview window
  // Translation: プレビューウィンドウの表示/非表示を切り替え
  const handlePreviewToggle = useCallback(
    async (enabled: boolean) => {
      if (!window.api?.camera) return

      try {
        if (enabled) {
          // Re-fetch the currently available camera devices
          // Translation: 現在利用可能なカメラデバイスを再取得
          await fetchAvailableCameras()

          // Get the IDs of the selected multiple cameras
          // Translation: 選択された複数カメラのIDを取得
          const selectedCameraIds = allowedCameras
            .filter((camera) => camera.enabled)
            .map((camera) => camera.id)

          // Match with actually available cameras
          // Translation: 実際に利用可能なカメラとマッチング
          const availableCameraIds = availableCameras.map((camera) => camera.id)
          const validCameraIds = selectedCameraIds.filter(
            (id) => availableCameraIds.includes(id) || id === 'default'
          )

          // Use the default camera if no valid cameras are found
          // Translation: 有効なカメラが見つからない場合はデフォルトカメラを使用
          const cameraIds = validCameraIds.length > 0 ? validCameraIds : ['default']

          console.log('Preview window - Available cameras:', availableCameraIds)
          console.log('Preview window - Selected cameras:', selectedCameraIds)
          console.log('Preview window - Valid cameras:', cameraIds)

          const result = await window.api.camera.showPreviewWindow({
            size: previewSize,
            opacity: previewOpacity,
            position: previewPosition,
            cameraIds: cameraIds,
            layout: cameraIds.length > 1 ? 'cascade' : 'single'
          })

          if (result.success) {
            setPreviewEnabled(true)
            setPreviewStatus({ isActive: true })
            console.log('Preview windows created successfully:', result.message)
          } else {
            console.error('Failed to create preview windows:', result.message)
            setPreviewEnabled(false)
            setPreviewStatus({ isActive: false })
          }
        } else {
          const result = await window.api.camera.hidePreviewWindow()
          if (result.success) {
            setPreviewEnabled(false)
            setPreviewStatus({ isActive: false })
            console.log('Preview windows closed successfully:', result.message)
          }
        }
      } catch (error) {
        console.error('Failed to toggle preview window:', error)
        setPreviewEnabled(false)
        setPreviewStatus({ isActive: false })
      }
    },
    [
      previewSize,
      previewOpacity,
      previewPosition,
      allowedCameras,
      availableCameras,
      fetchAvailableCameras
    ]
  )

  // Update the preview window settings
  // Translation: プレビューウィンドウの設定を更新
  const handlePreviewSettingsUpdate = useCallback(async () => {
    if (!window.api?.camera || !previewStatus.isActive) return

    try {
      await window.api.camera.updatePreviewSettings({
        size: previewSize,
        opacity: previewOpacity,
        position: previewPosition
      })
    } catch (error) {
      console.error('Failed to update preview settings:', error)
    }
  }, [previewSize, previewOpacity, previewPosition, previewStatus.isActive])

  // Automatically update when preview settings change
  // Translation: プレビュー設定が変更された時に自動更新
  useEffect(() => {
    if (previewStatus.isActive) {
      handlePreviewSettingsUpdate()
    }
  }, [previewSize, previewOpacity, previewPosition, handlePreviewSettingsUpdate])

  // Get the camera list and preview status on initial load
  // Translation: 初回読み込み時にカメラ一覧とプレビュー状態を取得
  useEffect(() => {
    fetchAvailableCameras()
    fetchPreviewStatus()
  }, [fetchAvailableCameras, fetchPreviewStatus])

  return (
    <div className="prose dark:prose-invert max-w-none w-full">
      {/* Tool description */}
      {/* Translation: ツールの説明 */}
      <div className="mb-6 w-full">
        <p className="mb-4 text-gray-700 dark:text-gray-300">
          {t(
            'tool info.cameraCapture.description',
            'The cameraCapture tool captures images from PC camera and saves them as image files. When a recognition prompt is provided, the captured image will be automatically analyzed with AI to extract text content, identify objects, and provide detailed visual descriptions for analysis and documentation purposes.'
          )}
        </p>
      </div>

      {/* Settings form */}
      {/* Translation: 設定フォーム */}
      <div className="flex flex-col gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-md mb-6 w-full">
        <h4 className="font-medium text-sm mb-2 dark:text-gray-200">
          {t('AI Image Analysis Settings')}
        </h4>

        {/* LLM model selection */}
        {/* Translation: LLMモデル選択 */}
        <div className="w-full">
          <Label htmlFor="cameraCaptureModel">{t('AI Model for Image Analysis')}</Label>
          <Select
            id="cameraCaptureModel"
            value={recognizeImageModel}
            onChange={(e) => setRecognizeImageModel(e.target.value)}
            className="mt-2 w-full"
          >
            {visionCapableModels.map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.modelName}
              </option>
            ))}
          </Select>
        </div>

        {/* Camera quality settings */}
        {/* Translation: カメラ品質設定 */}
        <div className="w-full">
          <Label htmlFor="cameraQuality">{t('Image Quality')}</Label>
          <Select id="cameraQuality" className="mt-2 w-full" defaultValue="medium">
            <option value="low">{t('Low (640x480)')}</option>
            <option value="medium">{t('Medium (1280x720)')}</option>
            <option value="high">{t('High (1920x1080)')}</option>
          </Select>
        </div>

        {/* How to use */}
        {/* Translation: 使用方法 */}
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 dark:border dark:border-blue-700 rounded-md">
          <h5 className="font-medium mb-2 dark:text-blue-300">{t('How to Use')}</h5>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>
              • <strong>{t('Camera capture only')}:</strong>{' '}
              {t('Use without any prompt to capture camera image only')}
            </li>
            <li>
              • <strong>{t('Camera capture + AI analysis')}:</strong>{' '}
              {t('Provide a recognition prompt to automatically analyze the captured image')}
            </li>
            <li>
              • <strong>{t('Example prompts')}:</strong>{' '}
              {t(
                '"Describe what you see in this image", "Read any text in this photo", "Identify objects in the camera view"'
              )}
            </li>
          </ul>
        </div>

        {/* Platform requirements */}
        {/* Translation: プラットフォーム要件 */}
        <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 dark:border dark:border-green-700 rounded-md">
          <h5 className="font-medium mb-2 dark:text-green-300">{t('Platform Requirements')}</h5>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>
              • <strong>macOS:</strong>{' '}
              {t(
                'Camera access permission required in System Preferences > Security & Privacy > Privacy > Camera'
              )}
            </li>
            <li>
              • <strong>Windows:</strong>{' '}
              {t('Camera access permission required in Windows Settings > Privacy > Camera')}
            </li>
          </ul>
        </div>
      </div>

      {/* Camera access permission settings */}
      {/* Translation: カメラアクセス許可設定 */}
      <div className="flex flex-col gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-md mb-6 w-full">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm mb-2 dark:text-gray-200">
            {t('Camera Access Permissions')}
          </h4>
          <Button
            size="sm"
            color="light"
            onClick={fetchAvailableCameras}
            disabled={isLoadingCameras}
            className="flex items-center gap-2"
          >
            <ArrowPathIcon className={`w-4 h-4 ${isLoadingCameras ? 'animate-spin' : ''}`} />
            {t('Refresh')}
          </Button>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(
            'Select which cameras this agent is allowed to access for image capture. Only selected cameras can be used for photography.'
          )}
        </p>

        {/* Camera preview grid */}
        {/* Translation: カメラプレビューグリッド */}
        {isLoadingCameras ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
            <span className="ml-3 text-gray-600 dark:text-gray-300">
              {t('Loading camera devices...')}
            </span>
          </div>
        ) : availableCameras.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <div className="text-4xl mb-2">📷</div>
            <p>{t('No cameras available. Click refresh to try again.')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-96 overflow-y-auto p-2">
            {availableCameras.map((camera) => {
              const isSelected = isCameraAllowed(camera)
              const hasImageError = imageLoadErrors.has(camera.id)

              return (
                <div
                  key={camera.id}
                  className={`
                    relative cursor-pointer transition-all duration-200 transform hover:scale-105
                    ${isSelected
                      ? 'ring-2 ring-blue-500 dark:ring-blue-400 shadow-lg'
                      : 'ring-1 ring-gray-200 dark:ring-gray-600 hover:ring-gray-300 dark:hover:ring-gray-500'
                    }
                    rounded-lg overflow-hidden bg-white dark:bg-gray-800
                  `}
                  onClick={() => handleCameraToggle(camera, !isSelected)}
                >
                  {/* Camera preview */}
                  {/* Translation: カメラプレビュー */}
                  <div className="relative aspect-video bg-gray-100 dark:bg-gray-700">
                    {hasImageError ? (
                      // React state-based fallback UI
                      // Translation: React状態ベースのフォールバックUI
                      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
                        <div className="text-center">
                          <div className="text-2xl mb-1">📷</div>
                          <div className="text-xs">{t('Preview not available')}</div>
                        </div>
                      </div>
                    ) : camera.thumbnail ? (
                      <img
                        src={camera.thumbnail}
                        alt={`Preview of ${camera.name}`}
                        className="w-full h-full object-cover"
                        onError={() => handleImageError(camera.id)}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
                        <div className="text-center">
                          <div className="text-2xl mb-1">📹</div>
                          <div className="text-xs">{t('Live Preview')}</div>
                        </div>
                      </div>
                    )}

                    {/* Selected state overlay */}
                    {/* Translation: 選択状態のオーバーレイ */}
                    {isSelected && (
                      <div className="absolute inset-0 bg-blue-500/20 dark:bg-blue-400/20 flex items-center justify-center">
                        <div className="bg-blue-500 dark:bg-blue-400 text-white rounded-full p-1">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      </div>
                    )}

                    {/* Camera resolution info */}
                    {/* Translation: カメラ解像度情報 */}
                    <div className="absolute top-1 right-1 bg-black/50 text-white text-xs px-1 py-0.5 rounded">
                      {camera.capabilities.maxWidth}×{camera.capabilities.maxHeight}
                    </div>
                  </div>

                  {/* Camera info */}
                  {/* Translation: カメラ情報 */}
                  <div className="p-3">
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                      {camera.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {camera.capabilities.supportedFormats.join(', ')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Number of allowed cameras */}
        {/* Translation: 許可されたカメラの数 */}
        {allowedCameras.length > 0 && (
          <div className="text-sm text-green-600 dark:text-green-400">
            {t('{{count}} camera(s) allowed', { count: allowedCameras.length })}
          </div>
        )}

        {/* Hints */}
        {/* Translation: ヒント */}
        <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 dark:border dark:border-yellow-700 rounded-md">
          <h5 className="font-medium mb-2 dark:text-yellow-300">{t('Usage Tips')}</h5>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>• {t('If no cameras are selected, the agent can use the default camera')}</li>
            <li>• {t('Camera permissions are checked each time before capture')}</li>
            <li>• {t('Use the refresh button to update the list of available cameras')}</li>
            <li>• {t('Live preview may not be available for all camera devices')}</li>
          </ul>
        </div>
      </div>

      {/* Camera preview window settings */}
      {/* Translation: カメラプレビューウィンドウ設定 */}
      <div className="flex flex-col gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-md mb-6 w-full">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm mb-2 dark:text-gray-200">
            {t('Camera Preview Window')}
          </h4>
          <div className="flex items-center gap-3">
            {previewStatus.isActive ? (
              <EyeIcon className="w-4 h-4 text-green-500" />
            ) : (
              <EyeSlashIcon className="w-4 h-4 text-gray-400" />
            )}
            <ToggleSwitch checked={previewEnabled} onChange={handlePreviewToggle} label="" />
          </div>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(
            'Display a live camera preview window on your screen. This allows you to see what the camera captures in real-time without taking photos.'
          )}
        </p>

        {/* Settings for when the preview window is enabled */}
        {/* Translation: プレビューウィンドウが有効な場合の設定 */}
        {previewEnabled && (
          <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-md border border-gray-200 dark:border-gray-600">
            {/* Window size settings */}
            {/* Translation: ウィンドウサイズ設定 */}
            <div className="w-full">
              <Label htmlFor="previewSize">{t('Preview Window Size')}</Label>
              <Select
                id="previewSize"
                value={previewSize}
                onChange={(e) => setPreviewSize(e.target.value as 'small' | 'medium' | 'large')}
                className="mt-2 w-full"
              >
                <option value="small">{t('Small (200×150)')}</option>
                <option value="medium">{t('Medium (320×240)')}</option>
                <option value="large">{t('Large (480×360)')}</option>
              </Select>
            </div>

            {/* Window position settings */}
            {/* Translation: ウィンドウ位置設定 */}
            <div className="w-full">
              <Label htmlFor="previewPosition">{t('Preview Window Position')}</Label>
              <Select
                id="previewPosition"
                value={previewPosition}
                onChange={(e) =>
                  setPreviewPosition(
                    e.target.value as 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
                  )
                }
                className="mt-2 w-full"
              >
                <option value="bottom-right">{t('Bottom Right')}</option>
                <option value="bottom-left">{t('Bottom Left')}</option>
                <option value="top-right">{t('Top Right')}</option>
                <option value="top-left">{t('Top Left')}</option>
              </Select>
            </div>

            {/* Opacity settings */}
            {/* Translation: 透明度設定 */}
            <div className="w-full">
              <Label htmlFor="previewOpacity">{t('Window Opacity')}</Label>
              <div className="flex items-center gap-4 mt-2">
                <input
                  type="range"
                  id="previewOpacity"
                  min="0.3"
                  max="1.0"
                  step="0.1"
                  value={previewOpacity}
                  onChange={(e) => setPreviewOpacity(parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                />
                <span className="text-sm text-gray-600 dark:text-gray-300 min-w-[4rem]">
                  {Math.round(previewOpacity * 100)}%
                </span>
              </div>
            </div>

            {/* Preview window status display */}
            {/* Translation: プレビューウィンドウの状態表示 */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 dark:border dark:border-blue-700 rounded-md">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className={`w-2 h-2 rounded-full ${previewStatus.isActive ? 'bg-green-500' : 'bg-gray-400'}`}
                ></div>
                <span className="text-sm font-medium dark:text-blue-300">
                  {previewStatus.isActive
                    ? t('Preview Window Active')
                    : t('Preview Window Inactive')}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {previewStatus.isActive
                  ? t('The camera preview window is currently displayed on your screen.')
                  : t('Enable the toggle above to show the camera preview window.')}
              </p>
            </div>
          </div>
        )}

        {/* Information about the preview window */}
        {/* Translation: プレビューウィンドウについての情報 */}
        <div className="mt-4 p-3 bg-purple-50 dark:bg-purple-900/20 dark:border dark:border-purple-700 rounded-md">
          <h5 className="font-medium mb-2 dark:text-purple-300">{t('Preview Window Features')}</h5>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>• {t('Always on top - stays visible above other windows')}</li>
            <li>• {t('Draggable - can be moved around the screen')}</li>
            <li>• {t('Live camera feed - shows real-time video from your camera')}</li>
            <li>• {t('Hover controls - settings and close buttons appear on mouse hover')}</li>
            <li>• {t('Automatic positioning - remembers your preferred screen location')}</li>
          </ul>
        </div>

        {/* Important notes */}
        {/* Translation: 注意事項 */}
        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 dark:border dark:border-amber-700 rounded-md">
          <h5 className="font-medium mb-2 dark:text-amber-300">{t('Important Notes')}</h5>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>• {t('Preview window requires camera permission')}</li>
            <li>• {t('Only one preview window can be active at a time')}</li>
            <li>• {t('Settings changes apply immediately to active preview')}</li>
            <li>• {t('Close the preview window to free up camera resources')}</li>
          </ul>
        </div>
      </div>
    </div>
  )
}