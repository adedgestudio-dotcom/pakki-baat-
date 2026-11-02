import { EntryPhotoError, PHOTO_BUCKET, PHOTO_TYPES, photoEntryId, readPhotoForm } from "./entry-photo";

type PhotoRow = { object_path: string; content_type: string; byte_size: number };
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Content-Type-Options": "nosniff" };

export function createEntryPhotoHandlers(config: () => { base: string; key: string }, fetcher: typeof fetch = fetch) {
  async function context(request: Request) {
    const { base, key } = config(), authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ") || authorization.length < 10) throw new EntryPhotoError("Sign in to view or add entry photos.", 401);
    if (!base || !key) throw new EntryPhotoError("Photo storage is not configured.", 503);
    const headers = { apikey: key, Authorization: authorization };
    const call = (path: string, init: RequestInit = {}) => fetcher(base + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(20000), headers: { ...headers, ...init.headers } });
    const auth = await call("/auth/v1/user");
    if (!auth.ok) throw new EntryPhotoError("Your sign-in has expired. Sign in again.", 401);
    const user = await auth.json();
    if (!/^[0-9a-f-]{36}$/i.test(user?.id || "")) throw new EntryPhotoError("Sign in again.", 401);
    const ownerId: string = user.id;
    async function photo(entryId: string): Promise<PhotoRow | null> {
      const query = new URLSearchParams({ owner_id: "eq." + ownerId, entry_id: "eq." + entryId, select: "object_path,content_type,byte_size" });
      const response = await call("/rest/v1/hisaab_entry_photos?" + query);
      if (!response.ok) throw new EntryPhotoError("Could not check this entry's photo. Retry online.", 503);
      const rows = await response.json();
      return rows[0] || null;
    }
    const removeUnlinked = (path: string) => call("/storage/v1/object/" + PHOTO_BUCKET, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [path] }),
    }).catch(() => null);
    return { call, ownerId, photo, removeUnlinked };
  }
  function failure(error: unknown) {
    return Response.json({ error: error instanceof EntryPhotoError ? error.message : "Photo connection failed. Retry when online." }, {
      status: error instanceof EntryPhotoError ? error.status : 503, headers: privateHeaders,
    });
  }
  return {
    async GET(request: Request) {
      try {
        const ctx = await context(request), entryId = photoEntryId(new URL(request.url).searchParams.get("entryId"));
        const row = await ctx.photo(entryId);
        if (!row) throw new EntryPhotoError("No photo is attached to this entry.", 404);
        const safePath = new RegExp("^" + ctx.ownerId + "/[0-9a-f-]{36}\\.(jpg|png|webp)$", "i");
        if (!safePath.test(row.object_path) || !PHOTO_TYPES.some(type => type === row.content_type)) throw new EntryPhotoError("Could not load this photo.", 503);
        const image = await ctx.call("/storage/v1/object/authenticated/" + PHOTO_BUCKET + "/" + row.object_path);
        if (!image.ok) throw new EntryPhotoError("Could not load this photo. Retry online.", 503);
        return new Response(await image.arrayBuffer(), { headers: { ...privateHeaders, "Content-Type": row.content_type } });
      } catch (error) { return failure(error); }
    },
    async POST(request: Request) {
      try {
        const ctx = await context(request), { entryId, file, bytes } = await readPhotoForm(request);
        if (await ctx.photo(entryId)) throw new EntryPhotoError("This entry already has its one photo.", 409);
        const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
        const path = ctx.ownerId + "/" + crypto.randomUUID() + "." + extension;
        const uploaded = await ctx.call("/storage/v1/object/" + PHOTO_BUCKET + "/" + path, {
          method: "POST", headers: { "Content-Type": file.type, "x-upsert": "false", "cache-control": "0" }, body: bytes,
        });
        if (!uploaded.ok) throw new EntryPhotoError("Photo upload failed. Check your connection and active plan, then retry.", uploaded.status === 403 ? 403 : 503);
        let linked: Response;
        try {
          linked = await ctx.call("/rest/v1/hisaab_entry_photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner_id: ctx.ownerId, entry_id: entryId, object_path: path, content_type: file.type, byte_size: file.size }) });
        } catch {
          // A lost response may already have committed. Never delete a possibly linked photo.
          const recovered = await ctx.photo(entryId).catch(() => undefined);
          if (recovered?.object_path === path) return Response.json({ ok: true }, { status: 201, headers: privateHeaders });
          if (recovered !== undefined) await ctx.removeUnlinked(path);
          throw new EntryPhotoError("Could not confirm the photo. Retry online to check whether it was saved.", 503);
        }
        if (!linked.ok) {
          await ctx.removeUnlinked(path);
          throw new EntryPhotoError(linked.status === 409 ? "This entry already has its one photo." : "Photo was not attached. Check that the entry is saved and your plan is active, then retry.", linked.status === 409 ? 409 : linked.status === 403 ? 403 : 503);
        }
        return Response.json({ ok: true }, { status: 201, headers: privateHeaders });
      } catch (error) { return failure(error); }
    },
  };
}
