'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient, useAuth } from '@/lib/auth-client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

function safeRedirect(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function CustomSignInForm() {
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const redirectUrl = safeRedirect(searchParams.get('redirect_url'));

  useEffect(() => {
    if (isLoaded && isSignedIn) window.location.assign(redirectUrl);
  }, [isLoaded, isSignedIn, redirectUrl]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);

    const result = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password,
      rememberMe: true
    });

    if (result.error) {
      toast.error(result.error.message || 'Email or password is not valid.');
      setIsLoading(false);
      return;
    }

    toast.success('Welcome back');
    window.location.assign(redirectUrl);
  };

  return (
    <div className='w-full space-y-4'>
      <form onSubmit={handleSubmit} className='w-full space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='email'>Email</Label>
          <Input
            id='email'
            name='email'
            type='email'
            autoComplete='email'
            placeholder='name@example.com'
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isLoading}
            required
            autoFocus
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='password'>Password</Label>
          <div className='relative'>
            <Input
              id='password'
              name='password'
              type={showPassword ? 'text' : 'password'}
              autoComplete='current-password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isLoading}
              className='pr-10'
              required
            />
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='absolute top-0 right-0 h-9 w-9'
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <Icons.eyeOff className='h-4 w-4' />
              ) : (
                <Icons.eye className='h-4 w-4' />
              )}
            </Button>
          </div>
        </div>

        <Button type='submit' className='w-full' disabled={isLoading}>
          {isLoading && <Icons.spinner className='mr-2 h-4 w-4 animate-spin' />}
          Sign in
        </Button>
      </form>
    </div>
  );
}
