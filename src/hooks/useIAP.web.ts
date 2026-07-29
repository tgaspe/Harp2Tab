import { useState } from 'react';

export const PRODUCT_SKU = 'harp2tab_premium';

interface IAPState {
  product:    null;
  purchasing: boolean;
  restoring:  boolean;
  error:      string | null;
  purchased:  boolean;
}

// react-native-iap (nitro-modules) is native-only. Web purchases will go
// through RevenueCat/Stripe instead — see the web version plan.
export function useIAP() {
  const [error, setError] = useState<string | null>(null);

  return {
    product:    null,
    purchasing: false,
    restoring:  false,
    error,
    purchased:  false,
    buy: async () => setError('Purchases on the web are coming soon.'),
    restore: async () => {
      setError('Purchases on the web are coming soon.');
      return false;
    },
  } satisfies IAPState & { buy: () => Promise<void>; restore: () => Promise<boolean> };
}
