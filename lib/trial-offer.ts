export type TrialSubscriptionState = {
  ownerId: string | null;
  status: "loading" | "existing" | "none" | "error";
};

export async function loadTrialSubscription<T>(ownerId: string, load: () => Promise<T | null>) {
  try {
    const subscription = await load();
    return { subscription, state: { ownerId, status: subscription ? "existing" : "none" } as TrialSubscriptionState };
  } catch {
    return { subscription: null, state: { ownerId, status: "error" } as TrialSubscriptionState };
  }
}

export function canOfferTrial(state: TrialSubscriptionState, ownerId: string | null): boolean {
  return Boolean(ownerId && state.ownerId === ownerId && state.status === "none");
}
