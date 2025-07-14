import { store } from '../../preload/store'
import en from '../../renderer/src/i18n/locales/en'
import ja from '../../renderer/src/i18n/locales/ja'

const translations = {
  en,
  ja
}

export function getI18nValue(key: string): string {
  const lang = store.get('language') || 'en'
  const langTranslations = translations[lang]

  if (!langTranslations) {
    return key
  }

  const keys = key.split('.')
  let value: any = langTranslations

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k]
    } else {
      return key
    }
  }

  return typeof value === 'string' ? value : key
}
