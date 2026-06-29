import { describe, expect, it } from 'vitest';
import { ExportService } from './export.service';
import { BadRequestException } from '@nestjs/common';

describe('ExportService', () => {
  const service = new ExportService();

  it('toCsv: empty rows -> empty string', () => {
    expect(service.toCsv([])).toBe('');
  });

  it('toCsv: 2 rows with header', () => {
    const csv = service.toCsv([
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
    ]);
    expect(csv.split('\n')).toEqual(['id,name', '1,a', '2,b']);
  });

  it('toCsv: escapes quotes, commas, newlines', () => {
    const csv = service.toCsv([{ name: 'a, b' }, { name: 'x"y' }, { name: 'plain' }]);
    expect(csv).toContain('"a, b"');
    expect(csv).toContain('"x""y"');
  });

  it('export csv format', () => {
    const r = service.export([{ id: '1', name: 'a' }], 'csv');
    expect(r.contentType).toBe('text/csv');
    expect(r.body as string).toContain('id,name');
  });

  it('export xlsx format returns buffer + correct content-type', () => {
    const r = service.export([{ id: '1' }], 'xlsx');
    expect(r.contentType).toContain('spreadsheetml');
    expect(Buffer.isBuffer(r.body)).toBe(true);
  });

  it('export pdf format returns buffer + correct content-type', () => {
    const r = service.export([{ id: '1' }], 'pdf');
    expect(r.contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(r.body)).toBe(true);
  });

  it('export rejects unsupported format', () => {
    expect(() => service.export([], 'xml' as any)).toThrow(BadRequestException);
  });
});
