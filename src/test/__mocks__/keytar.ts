const credentials = new Map<string, string>()

const buildKey = (service: string, account: string) => `${service}:${account}`

const keytarMock = {
  async setPassword(service: string, account: string, password: string): Promise<void> {
    credentials.set(buildKey(service, account), password)
  },

  async getPassword(service: string, account: string): Promise<string | null> {
    return credentials.get(buildKey(service, account)) ?? null
  },

  async deletePassword(service: string, account: string): Promise<boolean> {
    return credentials.delete(buildKey(service, account))
  }
}

export default keytarMock
