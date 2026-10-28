'use client';
/** The same password rules as the server: 8+ characters, a letter, a number, not the email. */
import Icon from '@/components/Icon';
import { useI18n } from '@/i18n';

export function passwordProblems(password: string, email = ''): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push('length');
  if (!/[A-Za-zÀ-ž]/.test(password)) problems.push('letter');
  if (!/\d/.test(password)) problems.push('digit');
  const lower = password.toLowerCase();
  const mail = email.trim().toLowerCase();
  if (mail && (lower === mail || lower === mail.split('@')[0])) problems.push('email');
  return problems;
}

export function PasswordRules({ password, email, id }: { password: string; email?: string; id?: string }) {
  const { t } = useI18n();
  const problems = passwordProblems(password, email);
  return (
    <ul className="password-rules" id={id} aria-live="polite">
      {['length', 'letter', 'digit', 'email'].map((r) => {
        const ok = password.length > 0 && !problems.includes(r);
        return (
          <li key={r} className={ok ? 'ok' : ''}>
            <Icon name={ok ? 'check' : 'minus'} size={14} strokeWidth={2.6} />
            {t(`auth.rules.${r}`)}
          </li>
        );
      })}
    </ul>
  );
}
