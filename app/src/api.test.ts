import { afterEach, expect, test, vi } from 'vitest'
import { ApiError, api } from './api'
import { API_BASE } from './config'

/**
 * A stand-in `fetch`. The parameters are declared even though they are unused,
 * so `mock.calls` is typed and the assertions below can read the URL and body.
 */
function stub(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
}

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
})

test('a list is fetched from the configured host', async () => {
  const fetchStub = stub(200, { slug: 'shaxzod', version: 1, items: [] })
  globalThis.fetch = fetchStub as unknown as typeof fetch

  expect((await api.getList('shaxzod')).slug).toBe('shaxzod')
  expect(fetchStub.mock.calls[0][0]).toBe(`${API_BASE}/api/lists/shaxzod`)
})

test('a failure carries the status and the server’s own message', async () => {
  globalThis.fetch = stub(404, { error: 'no such list' }) as unknown as typeof fetch

  await expect(api.getList('gone')).rejects.toBeInstanceOf(ApiError)
  await expect(api.getList('gone')).rejects.toMatchObject({
    status: 404,
    message: 'no such list',
  })
})

test('a failure with no JSON body still says something useful', async () => {
  globalThis.fetch = vi.fn(async () => ({
    ok: false,
    status: 502,
    json: async () => {
      throw new SyntaxError('not json')
    },
  })) as unknown as typeof fetch

  await expect(api.getList('x')).rejects.toMatchObject({
    status: 502,
    message: 'Request failed (502)',
  })
})

test('a patch sends only the fields it was given', async () => {
  const fetchStub = stub(200, { slug: 's', version: 2, items: [] })
  globalThis.fetch = fetchStub as unknown as typeof fetch

  await api.patchItem('s', 'item-1', { why: 'because' })

  const init = fetchStub.mock.calls[0][1] as RequestInit
  expect(init.method).toBe('PATCH')
  expect(JSON.parse(init.body as string)).toEqual({ why: 'because' })
})

test('every request identifies the device', async () => {
  const fetchStub = stub(200, { slug: 's', version: 1, items: [] })
  globalThis.fetch = fetchStub as unknown as typeof fetch

  await api.getList('s')

  const init = fetchStub.mock.calls[0][1] as RequestInit
  expect((init.headers as Record<string, string>)['X-Client-Id']).toBeTruthy()
})
