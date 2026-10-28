import Link from 'next/link';
import { IconArrowLeft } from '@tabler/icons-react';
import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { PageAnimation } from '@/components/layout/page-animation';

export default function PluginDetailLoading() {
  return (
    <PageContainer containerClassName='max-w-5xl'>
      <PageAnimation className='w-full space-y-8 pb-10'>
        {/* Navigation */}
        <div className='flex items-center justify-between'>
          <Button
            asChild
            variant='ghost'
            size='sm'
            className='text-muted-foreground hover:text-foreground shrink-0 pl-0'
          >
            <Link href='/plugins'>
              <IconArrowLeft className='mr-2 h-4 w-4' />
              Back to Plugins
            </Link>
          </Button>
        </div>

        {/* Hero Header Skeleton */}
        <div className='flex flex-col gap-6 md:flex-row md:items-start md:justify-between'>
          <div className='flex items-start gap-5'>
            <Skeleton className='h-20 w-20 shrink-0 rounded-[24px]' />
            <div className='space-y-3'>
              <div className='space-y-2'>
                <Skeleton className='h-8 w-48' />
                <Skeleton className='h-4 w-32' />
              </div>
              <div className='flex flex-wrap gap-2'>
                <Skeleton className='h-6 w-20 rounded-full' />
                <Skeleton className='h-6 w-24 rounded-full' />
              </div>
            </div>
          </div>
          <div className='flex shrink-0 flex-col gap-3'>
            <Skeleton className='h-10 w-32' />
          </div>
        </div>

        <Separator className='bg-zinc-200 dark:bg-zinc-800' />

        <div className='grid gap-8 lg:grid-cols-[2fr_1fr]'>
          {/* Left Column */}
          <div className='space-y-8'>
            {/* About Section */}
            <section className='space-y-4'>
              <Skeleton className='h-6 w-24' />
              <div className='space-y-2'>
                <Skeleton className='h-4 w-full' />
                <Skeleton className='h-4 w-full' />
                <Skeleton className='h-4 w-3/4' />
              </div>
            </section>

            {/* Transforms Section */}
            <section className='space-y-4'>
              <div className='flex items-center justify-between'>
                <Skeleton className='h-6 w-36' />
                <Skeleton className='h-6 w-8 rounded-full' />
              </div>
              <div className='space-y-1 rounded-xl border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50'>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className='flex items-start gap-2 py-1.5'>
                    <div className='flex flex-col items-center pt-1'>
                      <div className='text-muted-foreground flex h-4 w-4 items-center justify-center'>
                        {i === 4 ? '└' : '├'}
                      </div>
                    </div>
                    <div className='min-w-0 flex-1 space-y-2'>
                      <Skeleton className='h-4 w-48' />
                      <div className='flex items-center gap-1.5'>
                        <Skeleton className='h-5 w-16 rounded-md' />
                        <Skeleton className='h-3 w-3 rounded-full' />
                        <Skeleton className='h-5 w-16 rounded-md' />
                        <Skeleton className='h-5 w-16 rounded-md' />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right Column */}
          <div className='space-y-6'>
            {/* Information Card */}
            <Card className='overflow-hidden rounded-3xl border-zinc-200/50 bg-zinc-50/50 shadow-none dark:border-zinc-800/50 dark:bg-zinc-900/50'>
              <CardContent className='space-y-4 p-5 pt-4'>
                <Skeleton className='h-4 w-24' />
                <div className='space-y-4'>
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className='flex items-center justify-between'>
                      <Skeleton className='h-4 w-24' />
                      <Skeleton className='h-4 w-32' />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Configuration Status Card */}
            <Card className='overflow-hidden rounded-3xl border-zinc-200/50 bg-zinc-50/50 shadow-none dark:border-zinc-800/50 dark:bg-zinc-900/50'>
              <CardContent className='space-y-4 p-5 pt-4'>
                <Skeleton className='h-4 w-24' />
                <div className='rounded-xl bg-zinc-100 p-3 dark:bg-zinc-800/50'>
                  <Skeleton className='h-4 w-32' />
                  <Skeleton className='mt-2 h-3 w-full' />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </PageAnimation>
    </PageContainer>
  );
}
