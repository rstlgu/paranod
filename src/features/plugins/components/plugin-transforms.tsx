import styles from './plugin-catalog-entry.module.css';

export interface PluginTransformSummary {
  id: string;
  name: string;
  description?: string;
  inputType: string;
  outputTypes: string[];
}

export function PluginTransforms({
  transforms
}: {
  transforms: readonly PluginTransformSummary[];
}) {
  if (!transforms.length) {
    return (
      <p className={styles.empty}>No transforms declared by this extension.</p>
    );
  }

  return (
    <ul className={styles.transforms}>
      {transforms.map((transform) => (
        <li key={transform.id} className={styles.transform}>
          <div className={styles.transformCopy}>
            <p className={styles.transformName}>{transform.name}</p>
            {transform.description && (
              <p className={styles.description}>{transform.description}</p>
            )}
          </div>
          <p className={styles.types}>
            <span className='sr-only'>Input: </span>
            {transform.inputType}
            <span aria-hidden='true'> → </span>
            <span className='sr-only'>. Output: </span>
            {transform.outputTypes.join(', ') || 'None'}
          </p>
        </li>
      ))}
    </ul>
  );
}
