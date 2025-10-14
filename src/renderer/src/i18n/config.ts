import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import ja from './locales/ja'

const resources = {
  en: {
    translation: en
  },
  ja: {
    translation: ja
  }
}

const supportedLanguages = Object.keys(resources) as Array<keyof typeof resources>
const fallbackLanguage: keyof typeof resources = 'en'

function resolveInitialLanguage(): keyof typeof resources {
  const stored = window.store.get('language')
  if (stored && supportedLanguages.includes(stored)) {
    return stored
  }

  const browserLanguage = navigator.language?.split('-')[0]
  if (browserLanguage && supportedLanguages.includes(browserLanguage as keyof typeof resources)) {
    return browserLanguage as keyof typeof resources
  }

  return fallbackLanguage
}

i18n.use(initReactI18next).init({
  resources,
  lng: resolveInitialLanguage(),
  fallbackLng: fallbackLanguage,
  supportedLngs: supportedLanguages,
  interpolation: {
    escapeValue: false
  },
  returnNull: false
})

export default i18n
