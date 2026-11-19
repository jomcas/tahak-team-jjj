// The Group Hike QR code as dark-module runs (#23). Pure, tested under plain Node.
//
// qrcode-generator is plain JavaScript with no native code, so the leader's phone draws its QR
// code offline (ADR 0002) with ordinary Views: one View per horizontal run of dark modules.

import qrcode from 'qrcode-generator';

export type QrRun = { row: number; col: number; length: number };
export type QrMatrix = { size: number; runs: QrRun[] };

/** The QR code for text, at error correction level M (survives a scuffed or glary screen). */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  const runs: QrRun[] = [];
  for (let row = 0; row < size; row++) {
    let start = -1;
    for (let col = 0; col <= size; col++) {
      const dark = col < size && qr.isDark(row, col);
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        runs.push({ row, col: start, length: col - start });
        start = -1;
      }
    }
  }
  return { size, runs };
}

/** Whether the module at (row, col) is dark, read back from the runs (for tests). */
export function isDarkAt(matrix: QrMatrix, row: number, col: number): boolean {
  return matrix.runs.some((run) => run.row === row && col >= run.col && col < run.col + run.length);
}
