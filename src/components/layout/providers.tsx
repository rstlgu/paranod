'use client';
import React from 'react';
import { ActiveThemeProvider } from '../active-theme';
import { ThemeSync } from '../theme-sync';

export default function Providers({
  activeThemeValue,
  children
}: {
  activeThemeValue: string;
  children: React.ReactNode;
}) {
  return (
    <ActiveThemeProvider initialTheme={activeThemeValue}>
      <ThemeSync />
      {children}
    </ActiveThemeProvider>
  );
}
