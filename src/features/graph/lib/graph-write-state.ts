export interface GraphWriteState {
  // Advances at agent ownership boundaries, not on ordinary manual edits.
  version: number;
  locked: boolean;
  expiresAt: string | null;
}
