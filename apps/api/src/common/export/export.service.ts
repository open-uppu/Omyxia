import { Injectable, BadRequestException } from '@nestjs/common';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

@Injectable()
export class ExportService {
  toCsv(rows: Record<string, any>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(','));
    return lines.join('\n');
  }

  toXlsxPlaceholder(rows: Record<string, any>[]): Buffer {
    // Minimal "XLSX" — for unit testing only, real impl would use exceljs.
    return Buffer.from(this.toCsv(rows), 'utf8');
  }

  toPdfPlaceholder(rows: Record<string, any>[]): Buffer {
    // Minimal "PDF" — for unit testing only, real impl would use pdfkit.
    const lines = rows.map((r) => JSON.stringify(r)).join('\n');
    return Buffer.from(`PDF-PLACEHOLDER\n\n${lines}`, 'utf8');
  }

  export(rows: Record<string, any>[], format: ExportFormat): {
    contentType: string;
    body: Buffer | string;
  } {
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      throw new BadRequestException(`Unsupported format: ${format}`);
    }
    if (format === 'csv') return { contentType: 'text/csv', body: this.toCsv(rows) };
    if (format === 'xlsx')
      return {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: this.toXlsxPlaceholder(rows),
      };
    return { contentType: 'application/pdf', body: this.toPdfPlaceholder(rows) };
  }
}
