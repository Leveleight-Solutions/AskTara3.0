import type { StudioImport } from './studio.ts';

export const STUDIO_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const STUDIO_IMPORT_MAX_TEXT = 30_000;

export interface StudioImportInput {
  kind: StudioImport['kind'];
  name: string;
  /** Reviewed text or pasted email/PNR; never instructions to book or publish. */
  text?: string;
  /** A bounded base64 data URL. Raw bytes are not persisted. */
  data?: string;
  url?: string;
  /** Private provenance retained when saving reviewed URL extraction. */
  sourceUrl?: string;
}
