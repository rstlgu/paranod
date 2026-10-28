'use client';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarFooter
} from '@/components/ui/sidebar';
import { getVisibleNavItems } from '@/constants/data';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  CaretRightIcon as IconChevronRight,
  XIcon as IconX,
  ArrowUpRightIcon as IconArrowUpRight,
  ArrowsSplitIcon as IconArrowsSplit
} from '@/components/icons';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { Icons } from '../icons';
import { WorkspaceSwitcher } from '../workspace-switcher';
import { Button } from '@/components/ui/button';
import { UserNav } from './user-nav';

export default function AppSidebar() {
  const pathname = usePathname();
  const { isOpen } = useMediaQuery();
  const navItems = getVisibleNavItems();

  const getItemUrl = (item: (typeof navItems)[0]) => {
    return item.url;
  };

  React.useEffect(() => {
    // Side effects based on sidebar state changes
  }, [isOpen]);

  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader className='group-data-[collapsible=icon]:pb-1'>
        <WorkspaceSwitcher displayOnly />
      </SidebarHeader>
      <SidebarContent className='overflow-x-hidden'>
        <SidebarGroup className='group-data-[collapsible=icon]:pt-1'>
          <SidebarGroupLabel className='group-data-[collapsible=icon]:hidden'>
            Overview
          </SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const Icon = item.icon ? Icons[item.icon] : Icons.logo;
              const itemUrl = getItemUrl(item);

              return item?.items && item?.items?.length > 0 ? (
                <Collapsible
                  key={item.title}
                  asChild
                  defaultOpen={item.isActive}
                  className='group/collapsible'
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip={item.title}
                        isActive={pathname === itemUrl}
                      >
                        {item.icon && <Icon />}
                        <span>{item.title}</span>
                        <IconChevronRight className='ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90' />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items?.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === subItem.url}
                            >
                              <Link href={subItem.url}>
                                <span>{subItem.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              ) : (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild={!item.external}
                    tooltip={item.title}
                    isActive={!item.external && pathname === itemUrl}
                  >
                    {item.external ? (
                      item.disabled ? (
                        <div className='text-muted-foreground flex items-center gap-2 opacity-60'>
                          <Icon className='size-5 shrink-0' />
                          <span>{item.title}</span>
                          {item.label ? (
                            <span className='ml-auto text-[10px] font-medium uppercase'>
                              {item.label}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <a
                          href={itemUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='flex items-center gap-2'
                        >
                          <Icon className='size-5 shrink-0' />
                          <span>{item.title}</span>
                        </a>
                      )
                    ) : (
                      <Link href={itemUrl}>
                        {item.icon === 'flow' ? (
                          <IconArrowsSplit className='-rotate-90' />
                        ) : (
                          <Icon />
                        )}
                        <span>{item.title}</span>
                        {item.title === 'Customers' && (
                          <span className='ml-auto rounded-md bg-[#233527] px-1.5 py-0.5 text-[10px] font-medium text-[#4ade80]'>
                            6
                          </span>
                        )}
                        {item.title === 'Partners' && (
                          <span className='ml-auto rounded-md bg-[#233527] px-1.5 py-0.5 text-[10px] font-medium text-[#4ade80]'>
                            New
                          </span>
                        )}
                      </Link>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className='px-2 pt-2 pb-2 group-data-[collapsible=icon]:hidden'>
          <div className='relative mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4'>
            <div className='flex items-center justify-between'>
              <span className='rounded bg-[#233527] px-2 py-0.5 text-[10px] font-medium text-[#4ade80]'>
                New
              </span>
              <button className='text-zinc-400 transition-colors hover:text-white'>
                <IconX size={14} />
              </button>
            </div>
            <h4 className='mt-3 text-sm font-semibold text-zinc-100'>
              Partners affiliate program
            </h4>
            <p className='mt-1 text-xs text-zinc-400'>
              Run your own affiliate program with zero overhead
            </p>
            <Button
              variant='outline'
              size='sm'
              className='mt-3 h-8 w-full border-zinc-700 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white'
            >
              Try it out <IconArrowUpRight size={12} className='ml-1' />
            </Button>
          </div>
        </div>

        <div className='px-2 pb-3'>
          {/* Collapsed: solo avatar (più piccolo), centrato */}
          <div className='hidden items-center justify-center group-data-[collapsible=icon]:flex'>
            <UserNav size='sm' variant='avatar' />
          </div>
          {/* Expanded: card rettangolare stretta e lunga, allineata */}
          <div className='flex group-data-[collapsible=icon]:hidden'>
            <UserNav size='sm' variant='sidebar-card' />
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
