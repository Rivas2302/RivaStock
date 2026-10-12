import { describe, expect, it, vi } from 'vitest';

const { writeFile, bookAppend, sheet } = vi.hoisted(() => ({
  writeFile: vi.fn(), bookAppend: vi.fn(), sheet: vi.fn(() => ({})),
}));
vi.mock('xlsx', () => ({
  utils: { aoa_to_sheet: sheet, encode_cell: () => 'A1', book_new: () => ({}), book_append_sheet: bookAppend },
  writeFile,
}));
import { exportToExcel } from './exportUtils';

describe('asynchronous Excel export', () => {
  it('awaits generation and retains every filtered row rather than a displayed page', async () => {
    const rows = Array.from({ length: 123 }, (_, i) => ({ quantity: i + 1 }));
    await exportToExcel(rows, [{ header: 'Quantity', value: row => row.quantity }], 'full-report', 'Full report');
    expect(sheet).toHaveBeenCalledWith([['Quantity'], ...rows.map(row => [row.quantity])]);
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'full-report.xlsx');
    expect(bookAppend).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Full report');
  });
  it('propagates errors so calling pages can clear spinners and show failures', async () => {
    writeFile.mockImplementationOnce(() => { throw new Error('download failed'); });
    await expect(exportToExcel([], [], 'failed')).rejects.toThrow('download failed');
  });
});
