import { PASSWORD_RULES } from '@/lib/password';

/** Live list of the password rules: tick (green) when met, circle when not. Never relies on colour alone. */
export function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="space-y-0.5 text-sm" aria-label="Password rules">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.key} className={ok ? 'text-emerald-800' : 'text-slate-600'}>
            <span aria-hidden>{ok ? '✓' : '○'}</span> {r.label}
          </li>
        );
      })}
    </ul>
  );
}
