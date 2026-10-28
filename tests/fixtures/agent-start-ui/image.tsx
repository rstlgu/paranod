import type { ImgHTMLAttributes } from 'react';

export default function FixtureImage({
  fill: _fill,
  priority: _priority,
  unoptimized: _unoptimized,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
}) {
  return <img {...props} />;
}
