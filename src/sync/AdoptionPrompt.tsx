/**
 * Raises 7-11's second-account question wherever the user happens to be.
 *
 * Thin on purpose: the modal is presentation, the engine holds the decision, and this is the
 * three lines that join them. It lives in `src/sync/` rather than `src/components/` because the
 * only thing that can open it is the engine's adoption check — it is part of the sync feature,
 * not a reusable dialog.
 */

import React from 'react';
import { AdoptLibraryModal } from '@/components/AdoptLibraryModal';
import { useAuthStore } from '@/auth/useAuthStore';
import { adoptLocalLibrary, discardLocalLibrary } from './syncEngine';
import { useSyncStore } from './useSyncStore';

export function AdoptionPrompt() {
  const choice = useSyncStore((s) => s.pendingChoice);
  const email  = useAuthStore((s) => s.user?.email);

  // Only ever set by the engine, and only for a signed-in uid. The email guard covers the window
  // where a sign-out lands before the prompt is cleared: asking whose tabs these are while
  // naming nobody is worse than not asking.
  if (!choice || !email) return null;

  return (
    <AdoptLibraryModal
      visible
      email={email}
      tabCount={choice.tabCount}
      projectCount={choice.projectCount}
      onKeep={() => adoptLocalLibrary(choice.uid)}
      onClear={() => discardLocalLibrary(choice.uid)}
    />
  );
}
