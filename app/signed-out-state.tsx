"use client";

import { useId } from "react";

// Display only: a friendly prompt for signed-out visitors. Signing in uses the existing Google flow.
export default function SignedOutState({ title, text, onSignIn, canSignIn }: {
  title: string;
  text: string;
  onSignIn: () => void;
  canSignIn: boolean;
}) {
  const titleId = useId();
  return (
    <section className="signed-out-state" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <p>{text}</p>
      <button type="button" className="primary" onClick={onSignIn} disabled={!canSignIn}>
        Sign in
      </button>
    </section>
  );
}
