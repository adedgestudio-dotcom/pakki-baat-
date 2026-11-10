export type ReleaseIdentity = { version: string; commit: string | null };

export function releaseDiffers(current: ReleaseIdentity, latest: ReleaseIdentity) {
  if (latest.commit) return latest.commit !== current.commit;
  return latest.version !== current.version;
}

export function releaseCardVisible(current: ReleaseIdentity, latest: ReleaseIdentity | null, online: boolean) {
  return Boolean(online && latest && releaseDiffers(current, latest));
}

export function updateReloadBlocked(state: {
  entryOpen: boolean;
  hasDraft: boolean;
  hasText: boolean;
  voiceBusy: boolean;
}) {
  return state.entryOpen || state.hasDraft || state.hasText || state.voiceBusy;
}
