'use client';

import { HeroGraph } from '@/components/hero-graph';
import { Database, LockKey, ShieldCheck } from '@phosphor-icons/react';
import { CustomSignUpForm } from './custom-sign-up-form';

const setupFacts = [
  { icon: Database, label: 'Stored in your PostgreSQL database' },
  { icon: LockKey, label: 'Passwords protected with scrypt' },
  { icon: ShieldCheck, label: 'First account receives administrator access' }
];

export default function InitialSetupView() {
  return (
    <main className='bg-background grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(420px,560px)]'>
      <section className='relative hidden min-h-dvh overflow-hidden border-r bg-black lg:block'>
        <div className='absolute inset-0 opacity-75'>
          <HeroGraph
            isInteractive
            defaultViewport={{ x: 0, y: 0, zoom: 1.15 }}
          />
        </div>
        <div className='absolute inset-0 bg-black/35' />
        <div className='relative flex h-full max-w-2xl flex-col justify-between p-10 text-white'>
          <div className='flex items-center gap-3 text-lg font-semibold'>
            <div className='flex size-9 items-center justify-center rounded-md border border-white/15 bg-white/10'>
              <ShieldCheck className='size-5' weight='duotone' />
            </div>
            PARANOD Self-hosted
          </div>
          <div className='space-y-5 pb-6'>
            <p className='text-sm font-medium text-zinc-300'>INITIAL SETUP</p>
            <h1 className='max-w-xl text-4xl leading-tight font-semibold'>
              Your investigation workspace starts here.
            </h1>
            <p className='max-w-lg text-base leading-relaxed text-zinc-300'>
              Create the local administrator. Authentication, sessions and
              account data remain inside this installation.
            </p>
          </div>
        </div>
      </section>

      <section className='flex min-h-dvh items-center justify-center px-5 py-10 sm:px-10'>
        <div className='w-full max-w-md space-y-8'>
          <div className='space-y-2'>
            <div className='mb-5 flex size-10 items-center justify-center rounded-md border lg:hidden'>
              <ShieldCheck className='size-5' weight='duotone' />
            </div>
            <p className='text-muted-foreground text-sm font-medium'>
              PARANOD Self-hosted
            </p>
            <h2 className='text-2xl font-semibold'>Create the administrator</h2>
            <p className='text-muted-foreground text-sm leading-relaxed'>
              This is the only account that can be created without an existing
              administrator on this installation.
            </p>
          </div>

          <CustomSignUpForm />

          <div className='space-y-3 border-t pt-6'>
            {setupFacts.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className='text-muted-foreground flex items-center gap-3 text-sm'
              >
                <Icon className='text-foreground size-4 shrink-0' />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
