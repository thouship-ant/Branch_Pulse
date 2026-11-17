import { useState } from 'react';
import { RecipesPanel } from '@/components/ItemsRecipes';
import { Button, HeaderButton, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';

/** Recipes with cost per portion, margin and cost trend. */
export default function RecipesScreen() {
  const { can } = useSession();
  const [addSignal, setAddSignal] = useState(0);
  return (
    <Screen title="Recipes" headerRight={can('recipe:manage') ? <HeaderButton variant="secondary" icon="plus" title="Add" onPress={() => setAddSignal((n) => n + 1)} /> : undefined}>
      <RecipesPanel addSignal={addSignal} />
    </Screen>
  );
}
