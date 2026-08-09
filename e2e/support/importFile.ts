import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';

/** Wails binding ID of `App.PickImportFile` (frontend/bindings/…/app.ts). */
const PICK_IMPORT_FILE_ID = 452154835;

/** Answers the PickImportFile binding with a fixture path; unroute once the dialog has it. */
export async function stubImportFilePicker(page: Page, filePath: string): Promise<void> {
  await page.route('**/wails/runtime', async (route) => {
    const body = route.request().postDataJSON() as { args?: { methodID?: number } } | null;
    if (body?.args?.methodID !== PICK_IMPORT_FILE_ID) return route.fallback();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(filePath) });
  });
}

/** Writes a CSV to a temp dir and returns its path. */
export function writeCSVFixture(name: string, lines: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xensql-e2e-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}
