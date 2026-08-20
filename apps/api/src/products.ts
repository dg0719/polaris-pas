import { ontarioAutoV1, type ProductDefinition } from '@polaris/domain';
import { ApiError } from './errors.ts';

/**
 * Product registry. Products are configuration-as-data; adding a province or a
 * new version means adding a definition here, not changing the rating engine.
 */
const REGISTRY: ProductDefinition[] = [ontarioAutoV1];

export function listProducts(): ProductDefinition[] {
  return REGISTRY;
}

export function getProduct(productCode: string): ProductDefinition {
  const product = REGISTRY.find((p) => p.productCode === productCode);
  if (!product) throw ApiError.badRequest(`Unknown product ${productCode}`, 'unknown_product');
  return product;
}
