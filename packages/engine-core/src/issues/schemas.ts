/**
 * Pre-built Issue Schemas for Domain Modules (Section 13)
 *
 * Each schema defines the negotiable space for a specific domain.
 * MVP focuses on Electronics v1.
 */

import type { IssueSchema } from './types.js';

/**
 * Electronics Shipping v1 — Apple resale MVP (Section 13.1 + 18)
 *
 * Negotiable: price, ship_within_hours, shipping_method, warranty_days
 * Informational: battery_health, condition_grade
 */
export const ELECTRONICS_SHIPPING_V1: IssueSchema = {
  schema_id: 'electronics_shipping_v1',
  negotiable_issues: [
    {
      name: 'price',
      type: 'scalar',
      category: 'negotiable',
      direction: 'lower_better',
      min: 0,
      max: 10_000,
    },
    {
      name: 'ship_within_hours',
      type: 'deadline',
      category: 'negotiable',
      direction: 'lower_better',
      min: 1,
      max: 168, // 7 days
    },
    {
      name: 'shipping_method',
      type: 'enum',
      category: 'negotiable',
      direction: 'higher_better',
      values: ['ground', 'priority', 'express'],
    },
    {
      name: 'warranty_days',
      type: 'scalar',
      category: 'negotiable',
      direction: 'higher_better',
      min: 0,
      max: 365,
    },
  ],
  informational_issues: [
    {
      name: 'battery_health',
      type: 'scalar',
      category: 'informational',
      min: 0,
      max: 1,
    },
    {
      name: 'condition_grade',
      type: 'enum',
      category: 'informational',
      values: ['A', 'B', 'C', 'D'],
    },
  ],
  conditional_terms_supported: true,
};

/**
 * Vehicle v1 (Section 13.2) — future expansion
 */
export const VEHICLE_V1: IssueSchema = {
  schema_id: 'vehicle_v1',
  negotiable_issues: [
    { name: 'price', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 500_000 },
    { name: 'down_payment', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 100_000 },
    { name: 'financing_rate', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 30 },
    { name: 'delivery_date', type: 'deadline', category: 'negotiable', direction: 'lower_better', min: 1, max: 720 },
    { name: 'warranty', type: 'scalar', category: 'negotiable', direction: 'higher_better', min: 0, max: 120 },
  ],
  informational_issues: [
    { name: 'mileage', type: 'scalar', category: 'informational', min: 0, max: 500_000 },
    { name: 'title_status', type: 'enum', category: 'informational', values: ['clean', 'salvage', 'rebuilt'] },
  ],
  conditional_terms_supported: true,
};

/**
 * Real Estate v1 (Section 13.3) — future expansion
 */
export const REAL_ESTATE_V1: IssueSchema = {
  schema_id: 'real_estate_v1',
  negotiable_issues: [
    { name: 'price', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 50_000_000 },
    { name: 'deposit', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 5_000_000 },
    { name: 'closing_date', type: 'deadline', category: 'negotiable', direction: 'lower_better', min: 7, max: 180 },
    { name: 'inspection_period', type: 'scalar', category: 'negotiable', direction: 'higher_better', min: 0, max: 30 },
    { name: 'seller_credit', type: 'scalar', category: 'negotiable', direction: 'higher_better', min: 0, max: 100_000 },
    { name: 'rent_back', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 90 },
  ],
  informational_issues: [
    { name: 'financing_contingency', type: 'boolean', category: 'informational' },
  ],
  conditional_terms_supported: true,
};

/**
 * Services v1 (Section 13.4) — future expansion
 */
export const SERVICES_V1: IssueSchema = {
  schema_id: 'services_v1',
  negotiable_issues: [
    { name: 'price', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 1_000_000 },
    { name: 'response_time', type: 'deadline', category: 'negotiable', direction: 'lower_better', min: 1, max: 168 },
    { name: 'uptime', type: 'scalar', category: 'negotiable', direction: 'higher_better', min: 90, max: 100 },
    { name: 'contract_duration', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 1, max: 60 },
    { name: 'activation_deadline', type: 'deadline', category: 'negotiable', direction: 'lower_better', min: 1, max: 720 },
  ],
  informational_issues: [
    { name: 'SLA', type: 'enum', category: 'informational', values: ['basic', 'standard', 'premium', 'enterprise'] },
    { name: 'latency', type: 'scalar', category: 'informational', min: 0, max: 10_000 },
  ],
  conditional_terms_supported: true,
};
