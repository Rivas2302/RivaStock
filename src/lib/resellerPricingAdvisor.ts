import { roundPrice } from './utils';

export type ResellerPricingAdviceStatus =
  | 'missing_cost'
  | 'loss'
  | 'low_margin'
  | 'not_competitive'
  | 'balanced';

export type ResellerPricingAdviceFilter = 'all' | 'balanced' | 'review' | 'critical' | 'missing';

export interface ResellerPricingAdvice {
  status: ResellerPricingAdviceStatus;
  currentOwnerMarginPercent: number | null;
  currentResellerMarginPercent: number | null;
  maximumSafeDiscountPercent: number | null;
  suggestedDiscountPercent: number | null;
  suggestedPrice: number | null;
  message: string;
}

interface PricingAdvisorInput {
  retailPrice: number;
  purchaseCost: number;
  currentResellerPrice: number;
  minimumOwnerMarginPercent: number;
  targetResellerDiscountPercent: number;
}

export function matchesResellerPricingAdviceFilter(
  status: ResellerPricingAdviceStatus | undefined,
  filter: ResellerPricingAdviceFilter,
): boolean {
  if (filter === 'all') return true;
  if (!status) return false;
  if (filter === 'balanced') return status === 'balanced';
  if (filter === 'review') return status === 'low_margin' || status === 'not_competitive';
  if (filter === 'critical') return status === 'loss';
  return status === 'missing_cost';
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));
const floorToHalfPercent = (value: number): number => (
  Math.floor((value + 1e-9) * 2) / 2
);

export function getResellerPricingAdvice({
  retailPrice,
  purchaseCost,
  currentResellerPrice,
  minimumOwnerMarginPercent,
  targetResellerDiscountPercent,
}: PricingAdvisorInput): ResellerPricingAdvice {
  if (retailPrice <= 0 || purchaseCost <= 0) {
    return {
      status: 'missing_cost',
      currentOwnerMarginPercent: null,
      currentResellerMarginPercent: null,
      maximumSafeDiscountPercent: null,
      suggestedDiscountPercent: null,
      suggestedPrice: null,
      message: 'Cargá un costo y un precio minorista válidos para recibir una sugerencia.',
    };
  }

  const ownerTarget = Math.min(95, clampPercent(minimumOwnerMarginPercent));
  const resellerTarget = clampPercent(targetResellerDiscountPercent);
  const minimumSafePrice = Math.ceil(purchaseCost / (1 - ownerTarget / 100));
  const maximumSafeDiscount = floorToHalfPercent(
    (1 - minimumSafePrice / retailPrice) * 100,
  );
  const currentOwnerMargin = currentResellerPrice > 0
    ? ((currentResellerPrice - purchaseCost) / currentResellerPrice) * 100
    : -100;
  const currentResellerMargin = ((retailPrice - currentResellerPrice) / retailPrice) * 100;

  if (currentResellerPrice <= purchaseCost) {
    const canProtectMarginAtRetailPrice = minimumSafePrice <= retailPrice;
    return {
      status: 'loss',
      currentOwnerMarginPercent: currentOwnerMargin,
      currentResellerMarginPercent: currentResellerMargin,
      maximumSafeDiscountPercent: Math.max(0, maximumSafeDiscount),
      suggestedDiscountPercent: canProtectMarginAtRetailPrice ? Math.max(0, maximumSafeDiscount) : null,
      suggestedPrice: minimumSafePrice,
      message: canProtectMarginAtRetailPrice
        ? 'Este precio no cubre el costo. Subilo antes de publicar el producto.'
        : 'Este precio no cubre el costo y ni el precio minorista alcanza el margen objetivo. Conviene excluirlo o revisar costo y precio.',
    };
  }

  if (maximumSafeDiscount < 0) {
    return {
      status: 'not_competitive',
      currentOwnerMarginPercent: currentOwnerMargin,
      currentResellerMarginPercent: currentResellerMargin,
      maximumSafeDiscountPercent: 0,
      suggestedDiscountPercent: null,
      suggestedPrice: minimumSafePrice,
      message: 'Ni el precio minorista actual alcanza el margen objetivo. Conviene subir el precio de venta, mejorar el costo o excluirlo de revendedores.',
    };
  }

  if (currentOwnerMargin < ownerTarget || currentResellerMargin > maximumSafeDiscount) {
    return {
      status: 'low_margin',
      currentOwnerMarginPercent: currentOwnerMargin,
      currentResellerMarginPercent: currentResellerMargin,
      maximumSafeDiscountPercent: Math.max(0, maximumSafeDiscount),
      suggestedDiscountPercent: Math.max(0, maximumSafeDiscount),
      suggestedPrice: minimumSafePrice,
      message: `El descuento actual deja menos de ${ownerTarget.toFixed(0)}% de margen. Reducilo para proteger tu ganancia.`,
    };
  }

  if (maximumSafeDiscount < resellerTarget) {
    return {
      status: 'not_competitive',
      currentOwnerMarginPercent: currentOwnerMargin,
      currentResellerMarginPercent: currentResellerMargin,
      maximumSafeDiscountPercent: Math.max(0, maximumSafeDiscount),
      suggestedDiscountPercent: Math.max(0, maximumSafeDiscount),
      suggestedPrice: minimumSafePrice,
      message: `No alcanza el descuento atractivo de ${resellerTarget.toFixed(0)}% sin comprometer tu margen. Evaluá excluirlo o mejorar su costo.`,
    };
  }

  if (currentResellerMargin < resellerTarget) {
    const targetPrice = roundPrice(retailPrice * (1 - resellerTarget / 100));
    return {
      status: 'not_competitive',
      currentOwnerMarginPercent: currentOwnerMargin,
      currentResellerMarginPercent: currentResellerMargin,
      maximumSafeDiscountPercent: maximumSafeDiscount,
      suggestedDiscountPercent: resellerTarget,
      suggestedPrice: targetPrice,
      message: `Podés ofrecer ${resellerTarget.toFixed(0)}% de descuento y conservar tu margen objetivo.`,
    };
  }

  return {
    status: 'balanced',
    currentOwnerMarginPercent: currentOwnerMargin,
    currentResellerMarginPercent: currentResellerMargin,
    maximumSafeDiscountPercent: maximumSafeDiscount,
    suggestedDiscountPercent: currentResellerMargin,
    suggestedPrice: currentResellerPrice,
    message: 'El precio protege tu margen y ofrece un descuento atractivo al revendedor.',
  };
}
