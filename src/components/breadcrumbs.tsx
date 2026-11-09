'use client';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';
import { useBreadcrumbs } from '@/hooks/use-breadcrumbs';
import {
  CaretRightIcon as IconSlash,
  PencilSimpleIcon as IconEdit,
  CheckIcon as IconCheck,
  XIcon as IconX
} from '@/components/icons';
import { Fragment, useState, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function Breadcrumbs() {
  const items = useBreadcrumbs();
  const pathname = usePathname();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [localGraphName, setLocalGraphName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Controlla se siamo in una pagina di grafo
  const graphMatch = pathname.match(/^\/graphs\/([^/]+)$/);
  const graphId = graphMatch?.[1];
  const isGraphPage = !!graphId;
  const lastItem = items[items.length - 1];

  // Usa il nome locale se è stato modificato, altrimenti quello dal breadcrumb
  const displayTitle = localGraphName || lastItem?.title || '';

  // Reset nome locale quando cambia pagina o grafico
  useEffect(() => {
    setLocalGraphName(null);
    setIsEditing(false);
  }, [pathname, graphId]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    if (!isGraphPage || !displayTitle) return;
    setEditValue(displayTitle);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleSaveEdit = async () => {
    if (!graphId || !editValue.trim() || isSaving) return;

    const newName = editValue.trim();
    setIsSaving(true);

    try {
      const response = await fetch(`/api/graphs/${graphId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });

      if (response.ok) {
        // Aggiorna il nome localmente per cambio immediato
        setLocalGraphName(newName);
        toast.success('Graph renamed successfully');
        setIsEditing(false);
      } else {
        toast.error('Failed to rename graph');
      }
    } catch (error) {
      toast.error('An error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => (
          <Fragment key={item.title}>
            {index !== items.length - 1 && (
              <BreadcrumbItem className='hidden md:block'>
                <BreadcrumbLink href={item.link}>{item.title}</BreadcrumbLink>
              </BreadcrumbItem>
            )}
            {index < items.length - 1 && (
              <BreadcrumbSeparator className='hidden md:block'>
                <IconSlash />
              </BreadcrumbSeparator>
            )}
            {index === items.length - 1 && (
              <BreadcrumbItem>
                {isEditing && isGraphPage ? (
                  <div className='flex items-center gap-1'>
                    <Input
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit();
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                      className='h-7 w-40 text-sm'
                      disabled={isSaving}
                    />
                    <Button
                      size='icon'
                      variant='ghost'
                      className='h-7 w-7'
                      onClick={handleSaveEdit}
                      disabled={isSaving}
                    >
                      <IconCheck className='h-4 w-4' />
                    </Button>
                    <Button
                      size='icon'
                      variant='ghost'
                      className='h-7 w-7'
                      onClick={handleCancelEdit}
                      disabled={isSaving}
                    >
                      <IconX className='h-4 w-4' />
                    </Button>
                  </div>
                ) : (
                  <div
                    className='group flex items-center gap-1.5'
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                  >
                    <BreadcrumbPage
                      className={cn(
                        isGraphPage &&
                          displayTitle !== 'Loading...' &&
                          'hover:text-primary cursor-pointer transition-colors'
                      )}
                      onClick={
                        isGraphPage && displayTitle !== 'Loading...'
                          ? handleStartEdit
                          : undefined
                      }
                    >
                      {displayTitle}
                    </BreadcrumbPage>
                    {isGraphPage && displayTitle !== 'Loading...' && (
                      <Button
                        size='icon'
                        variant='ghost'
                        className={cn(
                          'h-5 w-5 transition-opacity',
                          isHovered ? 'opacity-100' : 'opacity-0'
                        )}
                        onClick={handleStartEdit}
                        title='Rename graph'
                      >
                        <IconEdit className='h-3 w-3' />
                      </Button>
                    )}
                  </div>
                )}
              </BreadcrumbItem>
            )}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
