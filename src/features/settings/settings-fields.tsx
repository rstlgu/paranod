import type { ReactNode } from 'react';
import styles from './settings-fields.module.css';

export { styles as settingsStyles };

export function SettingsSection({
  title,
  description,
  children,
  action
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
  className
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')}>
      <div className={styles.copy}>
        {htmlFor ? (
          <label htmlFor={htmlFor}>{label}</label>
        ) : (
          <div className={styles.label}>{label}</div>
        )}
        {description && <div className={styles.description}>{description}</div>}
      </div>
      {children && <div className={styles.control}>{children}</div>}
    </div>
  );
}
