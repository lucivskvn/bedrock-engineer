/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from '@testing-library/react'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      switch (key) {
        case 'organization.dropdownMenuLabel':
          return `Organization menu (current: ${options?.name ?? ''})`
        case 'allAgents':
          return 'All Agents'
        case 'organization.selectAllAgents':
          return 'Select All Agents'
        case 'contributors':
          return 'Contributors'
        case 'organization.selectContributors':
          return 'Select Contributors'
        case 'organization.selectSpecificOrganization':
          return `Select organization ${options?.name ?? ''}`
        case 'organization.editOrganization':
          return 'Edit organization'
        case 'organization.editActionAriaLabel':
          return `Edit organization ${options?.name ?? ''}`
        case 'organization.deleteOrganization':
          return 'Delete organization'
        case 'organization.deleteActionAriaLabel':
          return `Delete organization ${options?.name ?? ''}`
        case 'addOrganization':
          return 'Add Organization'
        default:
          return typeof options?.defaultValue === 'string'
            ? (options?.defaultValue as string)
            : key
      }
    },
    i18n: { language: 'en', changeLanguage: jest.fn() }
  })
}))

import { OrganizationSelector } from '../OrganizationSelector'

const createOrganizations = () => [
  {
    id: 'org-1',
    name: 'Engineering',
    s3Config: {
      bucket: 'engineering-bucket',
      region: 'us-west-2'
    }
  },
  {
    id: 'org-2',
    name: 'Product',
    s3Config: {
      bucket: 'product-bucket',
      region: 'us-west-2'
    }
  }
]

beforeAll(() => {
  class ResizeObserverMock {
    observe() {
      return null
    }
    unobserve() {
      return null
    }
    disconnect() {
      return null
    }
  }

  Object.defineProperty(global, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverMock
  })
})

describe('OrganizationSelector', () => {
  it('selects an organization when the option is clicked', async () => {
    const onSelect = jest.fn()
    const organizations = createOrganizations()

    render(
      <OrganizationSelector
        selectedOrganization="all"
        organizations={organizations}
        onSelectOrganization={onSelect}
        onAddOrganization={jest.fn()}
        onEditOrganization={jest.fn()}
        onDeleteOrganization={jest.fn()}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /All Agents/i }))
    })

    const engineeringOption = await screen.findByRole('option', {
      name: /Select organization Engineering/i
    })

    await act(async () => {
      fireEvent.click(engineeringOption)
    })

    expect(onSelect).toHaveBeenCalledWith('org-1')
  })

  it('invokes edit handler without changing selection', async () => {
    const onSelect = jest.fn()
    const onEdit = jest.fn()
    const organizations = createOrganizations()

    render(
      <OrganizationSelector
        selectedOrganization="org-1"
        organizations={organizations}
        onSelectOrganization={onSelect}
        onAddOrganization={jest.fn()}
        onEditOrganization={onEdit}
        onDeleteOrganization={jest.fn()}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Engineering/i }))
    })

    const editButton = screen.getByRole('button', {
      name: /Edit organization Engineering/i
    })

    await act(async () => {
      fireEvent.mouseDown(editButton)
      fireEvent.click(editButton)
    })

    expect(onEdit).toHaveBeenCalledWith(organizations[0])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('supports keyboard activation for inline actions without changing selection', async () => {
    const onSelect = jest.fn()
    const onEdit = jest.fn()
    const organizations = createOrganizations()

    render(
      <OrganizationSelector
        selectedOrganization="org-1"
        organizations={organizations}
        onSelectOrganization={onSelect}
        onAddOrganization={jest.fn()}
        onEditOrganization={onEdit}
        onDeleteOrganization={jest.fn()}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Engineering/i }))
    })

    const editButton = screen.getByRole('button', {
      name: /Edit organization Engineering/i
    })

    editButton.focus()

    await act(async () => {
      fireEvent.keyDown(editButton, { key: 'Enter' })
    })

    expect(onEdit).toHaveBeenCalledWith(organizations[0])
    expect(onSelect).not.toHaveBeenCalled()
  })
})
