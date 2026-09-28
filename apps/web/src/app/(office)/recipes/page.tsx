'use client';

import { useState } from 'react';
import { RawMaterialTrend } from '@/components/recipes/RawMaterialTrend';
import { RecipeManager } from '@/components/recipes/RecipeManager';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Tab = 'recipes' | 'rawMaterial';

/** Owner / accountant / stock manager: recipe costing for management accounting only — never a bill. */
export default function RecipesPage() {
  const { t } = useT();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('recipes');
  if (!can('recipe:view')) return <p className="card">{t('noAccess')}</p>;

  const tabs: Array<[Tab, string]> = [['recipes', t('tabRecipeList')], ['rawMaterial', t('tabRawMaterial')]];

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{t('recipesTitle')}</h2>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-touch whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-ink'}`}
          >{label}</button>
        ))}
      </div>
      {tab === 'recipes' && <RecipeManager />}
      {tab === 'rawMaterial' && <RawMaterialTrend />}
    </div>
  );
}
