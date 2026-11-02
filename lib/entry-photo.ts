export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_BUCKET = "hisaab-entry-photos";
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export class EntryPhotoError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function photoEntryId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value))
    throw new EntryPhotoError("Choose a saved Hisaab entry.");
  return value;
}

export function validatePhoto(file: { size: number; type: string }, bytes?: Uint8Array) {
  if (!PHOTO_TYPES.some(type => type === file.type)) throw new EntryPhotoError("Choose a JPG, PNG or WebP photo.", 415);
  if (file.size < 1 || file.size > PHOTO_MAX_BYTES) throw new EntryPhotoError("Choose a photo smaller than 5 MB.", 413);
  if (!bytes) return;
  const png = [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
  if (bytes.length !== file.size || !(file.type === "image/png" ? png : file.type === "image/jpeg" ? jpeg : webp))
    throw new EntryPhotoError("The file does not match its photo type.", 415);
}

export async function readPhotoForm(request: Request) {
  const limit = PHOTO_MAX_BYTES + 65536;
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data") || !request.body)
    throw new EntryPhotoError("Choose a photo to upload.");
  if (Number(request.headers.get("content-length")) > limit) throw new EntryPhotoError("Photo upload is too large.", 413);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new EntryPhotoError("Photo upload is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  let form: FormData;
  try { form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
  catch { throw new EntryPhotoError("Could not read the photo upload."); }
  const entryId = photoEntryId(form.get("entryId")), file = form.get("photo");
  if (!(file instanceof File) || form.getAll("photo").length !== 1) throw new EntryPhotoError("Choose exactly one photo.");
  validatePhoto(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  validatePhoto(file, bytes);
  return { entryId, file, bytes };
}
