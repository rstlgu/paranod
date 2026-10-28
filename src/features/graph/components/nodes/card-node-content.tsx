'use client';

import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ElementType,
  type RefObject
} from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { LinkableText } from '../linkable-text';
import type { OSINTNodeData } from '../../types';
import {
  cardFieldLabel,
  cardFields,
  cardImage,
  cardTitle,
  formatCardText,
  type CardFieldValue
} from '../graph-editor/utils/card-node';

const MAX_BADGES = 8;

interface CardNodeContentProps {
  data: OSINTNodeData;
  Icon: ElementType<{ className?: string }>;
  iconClassName?: string;
}

export function CardNodeContent({
  data,
  Icon,
  iconClassName
}: CardNodeContentProps) {
  const image = cardImage(data.metadata);
  const title = cardTitle(data);
  // The title already shows a row that repeats it, such as the name.
  const fields = cardFields(data.metadata).filter(
    ([, field]) =>
      typeof field !== 'string' ||
      field.toLowerCase() !== title.toLowerCase()
  );
  const value =
    typeof data.metadata?.value === 'string' ? data.metadata.value.trim() : '';
  const subtitle =
    value && value !== title && !fields.some(([, field]) => field === value)
      ? value
      : '';
  const provider =
    typeof data.metadata?.provider === 'string' ? data.metadata.provider : '';
  const listRef = useRef<HTMLDivElement>(null);
  const scrollable = useOverflow(listRef, fields.length);

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex items-center gap-3 px-3 pt-3 pb-2'>
        <CardImage
          key={image}
          src={image}
          Icon={Icon}
          iconClassName={iconClassName}
          contain={data.type === 'breach'}
        />
        <div className='min-w-0 flex-1'>
          <p
            className='line-clamp-2 text-sm leading-snug font-semibold break-words'
            title={title}
          >
            {title}
          </p>
          {subtitle ? (
            <div className='text-muted-foreground truncate text-xs' title={subtitle}>
              <LinkableText text={subtitle} truncate maxLength={60} onlyUrlsAndDomains />
            </div>
          ) : null}
        </div>
      </div>

      <div
        ref={listRef}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-3 pb-2',
          // Scrollable lists take the wheel and pointer; otherwise both keep
          // zooming and dragging the canvas.
          scrollable && 'nodrag nowheel'
        )}
        onCopy={(event) => event.stopPropagation()}
      >
        {fields.length ? (
          <dl className='grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1 text-xs'>
            {fields.map(([key, field]) => (
              <Fragment key={key}>
                <dt
                  className='text-muted-foreground truncate'
                  title={cardFieldLabel(key)}
                >
                  {cardFieldLabel(key)}
                </dt>
                <dd className='min-w-0'>
                  <CardValue value={field} />
                </dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <p className='text-muted-foreground text-xs italic'>No details</p>
        )}
      </div>

      {provider ? (
        <div className='text-muted-foreground flex items-center justify-between gap-2 border-t px-3 py-1.5 text-[10px]'>
          <span className='truncate'>via {provider}</span>
          <span className='shrink-0'>
            {fields.length} {fields.length === 1 ? 'field' : 'fields'}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function CardImage(props: {
  src?: string;
  Icon: ElementType<{ className?: string }>;
  iconClassName?: string;
  contain: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className='bg-muted flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border'>
      {props.src && !failed ? (
        <img
          src={props.src}
          alt=''
          draggable={false}
          loading='lazy'
          decoding='async'
          referrerPolicy='no-referrer'
          className={cn(
            'h-full w-full',
            props.contain ? 'object-contain p-1' : 'object-cover'
          )}
          onError={() => setFailed(true)}
        />
      ) : (
        <props.Icon
          className={cn('h-6 w-6', props.iconClassName ?? 'text-muted-foreground')}
        />
      )}
    </div>
  );
}

function CardValue({ value }: { value: CardFieldValue }) {
  if (typeof value === 'boolean')
    return <span className='font-medium'>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'number')
    return (
      <span className='font-medium tabular-nums'>{value.toLocaleString()}</span>
    );
  if (Array.isArray(value))
    return (
      <div className='flex flex-wrap gap-1'>
        {value.slice(0, MAX_BADGES).map((item, index) => (
          <Badge
            key={`${index}-${item}`}
            variant='secondary'
            className='max-w-full px-1.5 py-0 text-[10px] font-normal'
            title={item}
          >
            <span className='truncate'>{item}</span>
          </Badge>
        ))}
        {value.length > MAX_BADGES ? (
          <span className='text-muted-foreground text-[10px]'>
            +{value.length - MAX_BADGES}
          </span>
        ) : null}
      </div>
    );
  const text = formatCardText(value);
  return (
    <div className='line-clamp-2 font-medium break-words' title={text}>
      <LinkableText text={text} truncate maxLength={80} onlyUrlsAndDomains />
    </div>
  );
}

/** True when the element's content is taller than the element. */
function useOverflow(ref: RefObject<HTMLElement | null>, contentKey: unknown) {
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = () =>
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, contentKey]);
  return overflowing;
}
