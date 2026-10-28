import { lazy, Suspense, type ComponentType } from 'react';

export default function dynamic<P extends object>(
  loader: () => Promise<ComponentType<P> | { default: ComponentType<P> }>,
  options?: { ssr?: boolean; loading?: ComponentType }
) {
  const Component = lazy(async () => {
    const result = await loader();
    return { default: 'default' in result ? result.default : result };
  });
  const Loading = options?.loading;
  return function FixtureDynamic(props: P) {
    return <Suspense fallback={Loading ? <Loading /> : null}><Component {...props} /></Suspense>;
  };
}
