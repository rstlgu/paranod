'use client';

import { HeroGraph } from '@/components/hero-graph';
import { IconGraph } from '@tabler/icons-react';
import { CustomSignInForm } from './custom-sign-in-form';

export default function SignInViewPage() {
  return (
    <div className='relative h-screen flex-col items-center justify-center md:grid lg:max-w-none lg:grid-cols-2 lg:px-0'>
      <div className='relative hidden h-full flex-col overflow-hidden bg-black p-10 text-white lg:flex dark:border-r'>
        <div className='absolute inset-0 bg-black' />
        <div className='absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] bg-[size:40px_40px]' />

        {/* Interactive Graph Background - Zoomed In */}
        <div className='absolute inset-0 z-10 origin-center'>
          <HeroGraph
            isInteractive
            defaultViewport={{ x: 0, y: 0, zoom: 1.25 }}
          />
        </div>

        <div className='pointer-events-none relative z-20 flex items-center gap-2 text-lg font-bold'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/10 backdrop-blur-sm'>
            <IconGraph className='h-5 w-5 text-white' />
          </div>
          PARANOD
        </div>

        <div className='pointer-events-none relative z-20 mt-auto'>
          <p className='text-lg text-zinc-300'>
            Connect OSINT tools, explore relationships and investigate with your
            AI agent.
          </p>
        </div>
      </div>
      <div className='bg-background flex h-full items-center justify-center p-4 lg:p-8'>
        <div className='flex w-full max-w-md flex-col items-center justify-center space-y-6'>
          <div className='mb-4 flex flex-col space-y-2 text-center'>
            <h1 className='text-2xl font-semibold tracking-tight'>
              Welcome back
            </h1>
            <p className='text-muted-foreground text-sm'>
              Enter your credentials to access your workspace
            </p>
          </div>

          <CustomSignInForm />
        </div>
      </div>
    </div>
  );
}
