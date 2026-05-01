/**
 * HNP neutral issue registry.
 *
 * Core issue ids are stable public names for interoperable negotiation terms.
 * Vendor-specific extensions should use reverse-DNS ids such as
 * `com.vendor.issue.trade_in`.
 */

export const HNP_CORE_ISSUES = [
  'hnp.issue.price.total',
  'hnp.issue.condition.grade',
  'hnp.issue.condition.battery_health',
  'hnp.issue.delivery.window',
  'hnp.issue.warranty.remaining',
  'hnp.issue.bundle.accessory',
  'hnp.issue.payment.method',
] as const;

export type HnpCoreIssueId = (typeof HNP_CORE_ISSUES)[number];

export function isHnpCoreIssueId(issueId: string): issueId is HnpCoreIssueId {
  return (HNP_CORE_ISSUES as readonly string[]).includes(issueId);
}

export function isVendorIssueId(issueId: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+\.issue\.[a-z0-9_.-]+$/i.test(issueId);
}

export function isSupportedIssueId(issueId: string, supportedNamespaces: readonly string[]): boolean {
  if (isHnpCoreIssueId(issueId)) return true;
  return supportedNamespaces.some((namespace) => issueId === namespace || issueId.startsWith(`${namespace}.`));
}
