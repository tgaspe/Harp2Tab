import { useEffect, useState } from 'react';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  purchaseUpdatedListener,
  purchaseErrorListener,
  finishTransaction,
  getAvailablePurchases,
  type ProductAndroid,
} from 'react-native-iap';

import { MOCK_WEB_PLANS, type WebPlanId } from '@/billing/plans';

export const PRODUCT_SKU = 'harp2tab_premium';

interface IAPState {
  product:    ProductAndroid | null;
  purchasing: boolean;
  restoring:  boolean;
  error:      string | null;
  purchased:  boolean;
}

export function useIAP() {
  const [state, setState] = useState<IAPState>({
    product:    null,
    purchasing: false,
    restoring:  false,
    error:      null,
    purchased:  false,
  });

  useEffect(() => {
    let mounted = true;

    const purchaseSub = purchaseUpdatedListener(async (purchase) => {
      if (!purchase.purchaseToken) return;
      try {
        await finishTransaction({ purchase, isConsumable: false });
        if (mounted) setState(s => ({ ...s, purchasing: false, purchased: true, error: null }));
      } catch {
        if (mounted) setState(s => ({ ...s, purchasing: false }));
      }
    });

    const errorSub = purchaseErrorListener((err) => {
      if (mounted) setState(s => ({ ...s, purchasing: false, error: err.message ?? 'Purchase failed.' }));
    });

    (async () => {
      try {
        await initConnection();
        const products = await fetchProducts({ skus: [PRODUCT_SKU], type: 'in-app' });
        const product  = products?.find(p => p.id === PRODUCT_SKU) as ProductAndroid | undefined;
        if (mounted) setState(s => ({ ...s, product: product ?? null }));
      } catch {
        // Play Store unavailable in this environment — silently skip
      }
    })();

    return () => {
      mounted = false;
      purchaseSub.remove();
      errorSub.remove();
      endConnection();
    };
  }, []);

  /**
   * `planId` exists only so the shared paywall can call one signature on both platforms, and
   * is ignored: Android sells exactly one product (8-1's "web only" decision), so there is
   * nothing to choose between. Web's `useIAP.web.ts` is the file that uses it.
   */
  async function buy(_planId?: WebPlanId) {
    setState(s => ({ ...s, purchasing: true, error: null }));
    try {
      await requestPurchase({
        request: { android: { skus: [PRODUCT_SKU] } },
        type: 'in-app',
      });
      // result arrives via purchaseUpdatedListener
    } catch {
      setState(s => ({ ...s, purchasing: false }));
    }
  }

  async function restore(): Promise<boolean> {
    setState(s => ({ ...s, restoring: true, error: null }));
    try {
      const purchases = await getAvailablePurchases();
      const found = purchases?.some(p => p.productId === PRODUCT_SKU);
      if (found) {
        setState(s => ({ ...s, restoring: false, purchased: true }));
        return true;
      }
      setState(s => ({ ...s, restoring: false, error: 'No previous purchase found for this account.' }));
      return false;
    } catch {
      setState(s => ({ ...s, restoring: false, error: 'Could not connect to the Play Store.' }));
      return false;
    }
  }

  /**
   * The plan list, so both platforms return the same shape. Native's copy is the static one —
   * there is no offering to price it from, and `PlanPicker.tsx` ignores the list anyway and
   * renders the single Play Billing price.
   */
  return { ...state, plans: MOCK_WEB_PLANS, buy, restore };
}
