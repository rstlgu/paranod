'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { useState } from 'react';
import { toast } from 'sonner';

export function CustomSignUpForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (password.length < 10) {
      toast.error('Use at least 10 characters for the password.');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    const result = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password
    });

    if (result.error) {
      toast.error(result.error.message || 'Unable to create the account.');
      setIsLoading(false);
      return;
    }

    toast.success('Administrator account created');
    window.location.assign('/');
  };

  return (
    <div className='w-full space-y-4'>
      <form onSubmit={handleSubmit} className='w-full space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='name'>Full name</Label>
          <Input
            id='name'
            name='name'
            autoComplete='name'
            placeholder='Jane Doe'
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isLoading}
            minLength={2}
            required
            autoFocus
          />
        </div>

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
          />
        </div>

        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='password'>Password</Label>
            <span className='text-muted-foreground text-xs'>
              10 characters minimum
            </span>
          </div>
          <div className='relative'>
            <Input
              id='password'
              name='password'
              type={showPassword ? 'text' : 'password'}
              autoComplete='new-password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isLoading}
              minLength={10}
              maxLength={128}
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

        <div className='space-y-2'>
          <Label htmlFor='confirm-password'>Confirm password</Label>
          <Input
            id='confirm-password'
            name='confirm-password'
            type={showPassword ? 'text' : 'password'}
            autoComplete='new-password'
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={isLoading}
            minLength={10}
            maxLength={128}
            required
          />
        </div>

        <Button type='submit' className='w-full' disabled={isLoading}>
          {isLoading && <Icons.spinner className='mr-2 h-4 w-4 animate-spin' />}
          Create administrator
        </Button>
      </form>
    </div>
  );
}
