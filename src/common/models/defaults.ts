/**
 * Shared Amazon Bedrock model defaults used by preload/main tooling.
 */

/**
 * Default Claude vision model used when a specific model has not been configured.
 *
 * Keeping the identifier in one place prevents drift between the RecognizeImage,
 * ScreenCapture, and CameraCapture toolchains when the recommended vision
 * release is updated.
 */
export const DEFAULT_RECOGNIZE_IMAGE_MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0' as const
