import en from './locales/en'
import ja from './locales/ja'

export type Locale = 'en' | 'ja'

const resources = { en, ja }

export function t(key: string, locale: Locale = 'en'): string {
  const parts = key.split('.')
  let result: any = resources[locale] as any
  for (const part of parts) {
    result = result?.[part]
    if (result === undefined) {
      return key
    }
  }
  return typeof result === 'string' ? result : key
}
