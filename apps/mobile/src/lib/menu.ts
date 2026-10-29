import type { IconName } from '@/components/ui';

export interface MenuItem { path: string; title: string; icon: IconName; perm: string; hint: string }
export interface MenuGroup { title: string; items: MenuItem[] }

/** The back-office sections, as on the web sidebar, each shown only to users who hold its permission. */
export const MENU: MenuGroup[] = [
  {
    title: 'Daily',
    items: [
      { path: '/more/closings', title: 'Closings', icon: 'check-square', perm: 'closing:view', hint: 'Branch closings by date' },
      { path: '/more/cash', title: 'Cash', icon: 'dollar-sign', perm: 'cash:view', hint: 'Reconciliation and variances' },
    ],
  },
  {
    title: 'Money',
    items: [
      { path: '/more/expenses', title: 'Expenses', icon: 'credit-card', perm: 'expense:view', hint: 'Ledger, summary, categories' },
      { path: '/more/purchases', title: 'Purchases', icon: 'shopping-bag', perm: 'purchase:view', hint: 'Purchases and suppliers' },
      { path: '/more/pl', title: 'Profit & Loss', icon: 'trending-up', perm: 'pl:view', hint: 'By branch and consolidated' },
    ],
  },
  {
    title: 'Stock',
    items: [
      { path: '/more/inventory', title: 'Inventory', icon: 'box', perm: 'stock:view', hint: 'Items, stock, transfers, wastage' },
      { path: '/more/recipes', title: 'Recipes', icon: 'coffee', perm: 'recipe:view', hint: 'Recipe cost and trends' },
    ],
  },
  {
    title: 'People',
    items: [
      { path: '/more/employees', title: 'Employees', icon: 'users', perm: 'staff:view', hint: 'Staff, attendance, salary, advances' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { path: '/more/branches', title: 'Branches', icon: 'map-pin', perm: 'location:manage', hint: 'Branches and godowns' },
      { path: '/more/users', title: 'Users', icon: 'user-check', perm: 'user:manage', hint: 'Logins, roles, branches' },
      { path: '/more/settings', title: 'Settings', icon: 'sliders', perm: 'settings:manage', hint: 'Rules, limits, roles, units' },
    ],
  },
];
