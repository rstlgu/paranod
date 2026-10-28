import { lazy, Suspense, type ComponentType } from 'react';
export default function dynamic(loader: () => Promise<ComponentType<any>>) {
  const Component = lazy(async () => ({ default: await loader() }));
  return function FixtureDynamic(props: any) {
    return (
      <Suspense fallback={null}>
        <Component {...props} />
      </Suspense>
    );
  };
}
