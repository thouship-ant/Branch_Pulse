import { RecipesPanel } from '@/components/ItemsRecipes';
import { Screen } from '@/components/ui';

/** Recipes with cost per portion, margin and cost trend. */
export default function RecipesScreen() {
  return (
    <Screen title="Recipes">
      <RecipesPanel />
    </Screen>
  );
}
