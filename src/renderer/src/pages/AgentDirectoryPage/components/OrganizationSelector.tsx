import React, { Fragment, KeyboardEvent } from 'react'
import { Listbox, Transition } from '@headlessui/react'
import { useTranslation } from 'react-i18next'
import { HiOfficeBuilding, HiChevronDown, HiPlus, HiPencil, HiTrash } from 'react-icons/hi'
import { BsGlobeAmericas } from 'react-icons/bs'
import { HiUserGroup } from 'react-icons/hi2'

import { OrganizationConfig } from '@/types/agent-chat'
import { cn } from '@renderer/lib/util'

interface OrganizationSelectorProps {
  selectedOrganization: string | 'all' | 'contributors'
  organizations: OrganizationConfig[]
  onSelectOrganization: (orgId: string | 'all' | 'contributors') => void
  onAddOrganization: () => void
  onEditOrganization: (org: OrganizationConfig) => void
  onDeleteOrganization: (org: OrganizationConfig) => void
}

export const OrganizationSelector: React.FC<OrganizationSelectorProps> = ({
  selectedOrganization,
  organizations,
  onSelectOrganization,
  onAddOrganization,
  onEditOrganization,
  onDeleteOrganization
}) => {
  const { t } = useTranslation()

  const getDisplayName = (orgId: string | 'all' | 'contributors'): string => {
    switch (orgId) {
      case 'all':
        return t('allAgents', 'All Agents')
      case 'contributors':
        return t('contributors', 'Contributors')
      default: {
        const org = organizations.find((o) => o.id === orgId)
        return org?.name || t('organization.unknownOrganization', 'Unknown Organization')
      }
    }
  }

  const selectedDisplayName = getDisplayName(selectedOrganization)
  const menuLabel = t('organization.dropdownMenuLabel', {
    name: selectedDisplayName,
    defaultValue: `Organization menu (current: ${selectedDisplayName})`
  })

  const handleInlineActionKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.click()
    }
  }

  return (
    <Listbox value={selectedOrganization} onChange={onSelectOrganization}>
      {({ open }) => (
        <div className="relative flex items-center gap-2">
          <Listbox.Button
            aria-label={menuLabel}
            title={menuLabel}
            className={cn(
              'flex min-w-[14rem] items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:bg-gray-50',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
              'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            )}
          >
            <HiOfficeBuilding className="h-4 w-4" aria-hidden="true" />
            <span className="truncate text-left">
              {selectedDisplayName}
            </span>
            <HiChevronDown
              className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : 'rotate-0'}`}
              aria-hidden="true"
            />
          </Listbox.Button>

          <Transition
            as={Fragment}
            show={open}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Listbox.Options
              className={cn(
                'absolute right-0 z-20 mt-2 w-full min-w-[16rem] overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-lg focus:outline-none',
                'dark:border-gray-700 dark:bg-gray-800'
              )}
            >
              <Listbox.Option
                value="all"
                aria-label={t('organization.selectAllAgents', 'Select All Agents')}
                className={({ active, selected }) =>
                  cn(
                    'cursor-pointer select-none px-3 py-2 text-left transition-colors duration-200',
                    active && 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white',
                    !active && selected && 'bg-gray-50 text-gray-900 dark:bg-gray-700/60 dark:text-white',
                    !active && !selected && 'text-gray-700 dark:text-gray-200'
                  )
                }
              >
                {({ selected }) => (
                  <div className="flex items-center" role="menuitemradio" aria-checked={selected}>
                    <BsGlobeAmericas className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>{t('allAgents', 'All Agents')}</span>
                  </div>
                )}
              </Listbox.Option>

              <Listbox.Option
                value="contributors"
                aria-label={t('organization.selectContributors', 'Select Contributors')}
                className={({ active, selected }) =>
                  cn(
                    'cursor-pointer select-none px-3 py-2 text-left transition-colors duration-200',
                    active && 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white',
                    !active && selected && 'bg-gray-50 text-gray-900 dark:bg-gray-700/60 dark:text-white',
                    !active && !selected && 'text-gray-700 dark:text-gray-200'
                  )
                }
              >
                {({ selected }) => (
                  <div className="flex items-center" role="menuitemradio" aria-checked={selected}>
                    <HiUserGroup className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>{t('contributors', 'Contributors')}</span>
                  </div>
                )}
              </Listbox.Option>

              {organizations.length > 0 && (
                <li role="none" className="mx-3 my-1 border-t border-gray-200 dark:border-gray-700" />
              )}

              {organizations.map((org) => (
                <Listbox.Option
                  key={org.id}
                  value={org.id}
                  className={({ active, selected }) =>
                    cn(
                      'group cursor-pointer select-none px-3 py-2 text-left transition-colors duration-200',
                      active && 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white',
                      !active && selected && 'bg-gray-50 text-gray-900 dark:bg-gray-700/60 dark:text-white',
                      !active && !selected && 'text-gray-700 dark:text-gray-200'
                    )
                  }
                  aria-label={t('organization.selectSpecificOrganization', {
                    name: org.name
                  })}
                >
                  {({ selected }) => (
                    <div
                      className="flex w-full items-center justify-between gap-2"
                      role="menuitemradio"
                      aria-checked={selected}
                    >
                      <div className="flex min-w-0 flex-1 items-center">
                        <HiOfficeBuilding className="mr-2 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                        <span className="truncate">{org.name}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => {
                            event.stopPropagation()
                            onEditOrganization(org)
                          }}
                          onKeyDown={handleInlineActionKey}
                          className={cn(
                            'rounded p-1 text-gray-500 transition-colors duration-200 hover:bg-gray-200 hover:text-gray-700',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
                            'dark:hover:bg-gray-600 dark:hover:text-gray-300'
                          )}
                          title={t('organization.editOrganization')}
                          aria-label={t('organization.editActionAriaLabel', {
                            name: org.name
                          })}
                        >
                          <HiPencil className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => {
                            event.stopPropagation()
                            onDeleteOrganization(org)
                          }}
                          onKeyDown={handleInlineActionKey}
                          className={cn(
                            'rounded p-1 text-gray-500 transition-colors duration-200 hover:bg-red-100 hover:text-red-600',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500',
                            'dark:hover:bg-red-900/20 dark:hover:text-red-400'
                          )}
                          title={t('organization.deleteOrganization')}
                          aria-label={t('organization.deleteActionAriaLabel', {
                            name: org.name
                          })}
                        >
                          <HiTrash className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}
                </Listbox.Option>
              ))}

              <li role="none" className="mx-3 my-1 border-t border-gray-200 dark:border-gray-700" />

              <li role="none">
                <button
                  type="button"
                  onClick={onAddOrganization}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
                    'dark:text-gray-200 dark:hover:bg-gray-700 dark:hover:text-white'
                  )}
                >
                  <HiPlus className="h-4 w-4" aria-hidden="true" />
                  {t('addOrganization', 'Add Organization')}
                </button>
              </li>
            </Listbox.Options>
          </Transition>
        </div>
      )}
    </Listbox>
  )
}
