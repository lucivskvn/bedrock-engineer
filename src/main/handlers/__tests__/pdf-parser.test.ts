jest.mock('pdf-parse', () => jest.fn())

import pdfParse from 'pdf-parse'

import {
  PDFParse,
  resetPdfParseCacheForTests,
  type PdfParseFunction
} from '../pdf/parser'

const pdfParseMock = pdfParse as unknown as jest.MockedFunction<PdfParseFunction>

describe('PDFParse', () => {
  beforeEach(() => {
    pdfParseMock.mockReset()
    resetPdfParseCacheForTests()
  })

  it('parses once per instance and reuses the cached result', async () => {
    pdfParseMock.mockResolvedValue({
      text: 'Example text',
      numpages: 3,
      info: { Title: 'Example title' },
      metadata: {
        get: (key: string) => ({
          CreationDate: '2024-01-02T00:00:00Z',
          'xmp:CreateDate': '2024-01-03T00:00:00Z',
          'xap:CreateDate': '2024-01-04T00:00:00Z',
          'xmp:MetadataDate': '2024-01-05T00:00:00Z'
        }[key])
      }
    } as never)

    const parser = new PDFParse({ data: Buffer.from('pdf data') })

    const textSummary = await parser.getText()
    const infoSummary = await parser.getInfo()

    expect(pdfParseMock).toHaveBeenCalledTimes(1)
    expect(textSummary).toEqual({ text: 'Example text', total: 3 })
    expect(infoSummary.total).toBe(3)
    expect(infoSummary.info).toEqual({ Title: 'Example title' })
    expect(infoSummary.getDateNode()).toEqual({
      CreationDate: '2024-01-02T00:00:00Z',
      XmpCreateDate: '2024-01-03T00:00:00Z',
      XapCreateDate: '2024-01-04T00:00:00Z',
      MetadataDate: '2024-01-05T00:00:00Z'
    })
  })

  it('resets the cached parse promise after failures and surfaces structured errors', async () => {
    const parseError = Object.assign(new Error('permission denied /tmp/test.pdf'), {
      code: 'EACCES'
    })

    pdfParseMock.mockRejectedValueOnce(parseError)
    pdfParseMock.mockResolvedValue({
      text: 'Recovered text',
      numpages: 1
    } as never)

    const parser = new PDFParse({ data: Buffer.from('pdf data') })

    await expect(parser.getText()).rejects.toMatchObject({
      code: 'PDF_PARSE_FAILED',
      message: 'PDF file could not be parsed.',
      metadata: expect.objectContaining({
        reason: 'parse_execution_failed',
        errorCode: 'EACCES',
        errorSummary: expect.objectContaining({
          name: 'Error',
          message: 'permission denied /tmp/test.pdf'
        })
      })
    })

    const summary = await parser.getText()

    expect(summary).toEqual({ text: 'Recovered text', total: 1 })
    expect(pdfParseMock).toHaveBeenCalledTimes(2)
  })
})
