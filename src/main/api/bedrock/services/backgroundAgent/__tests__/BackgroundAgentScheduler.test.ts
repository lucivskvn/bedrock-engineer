jest.mock('../BackgroundAgentService', () => ({
  BackgroundAgentService: jest.fn().mockImplementation(() => ({
    setExecutionHistoryUpdateCallback: jest.fn()
  }))
}))

jest.mock('../../NotificationService', () => ({
  MainNotificationService: jest.fn().mockImplementation(() => ({}))
}))

jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({ stop: jest.fn(), destroy: jest.fn() }),
  validate: jest.fn().mockReturnValue(true)
}))

jest.mock('electron-store', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn()
  }))
})

import * as cron from 'node-cron'
import { BackgroundAgentScheduler } from '../BackgroundAgentScheduler'
import { ScheduledTask } from '../types'

describe('BackgroundAgentScheduler timezone', () => {
  const scheduleMock = cron.schedule as jest.Mock

  const createScheduler = (tz: string) => {
    const mockStore = {
      get: (key: string) => {
        if (key === 'timezone') return tz
        if (key === 'backgroundAgentScheduledTasks') return []
        return undefined
      },
      set: jest.fn()
    }
    return new BackgroundAgentScheduler({ store: mockStore as any }, tz)
  }

  beforeEach(() => {
    scheduleMock.mockClear()
  })

  it.each(['Asia/Tokyo', 'America/New_York'])('uses provided timezone %s', (tz) => {
    const scheduler = createScheduler(tz)
    const task: ScheduledTask = {
      id: '1',
      name: 'test',
      cronExpression: '* * * * *',
      agentId: 'a',
      modelId: 'm',
      wakeWord: 'hello',
      enabled: true,
      createdAt: Date.now(),
      runCount: 0
    }
    ;(scheduler as any).startCronJob(task)
    expect(scheduleMock).toHaveBeenCalledWith(
      task.cronExpression,
      expect.any(Function),
      expect.objectContaining({ timezone: tz })
    )
  })
})
