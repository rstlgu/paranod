/**
 * Single source of truth for OSINT node/entity types.
 *
 * - Used by the graph editor (palette/menu + node creation defaults)
 * - Used by plugin system (EntityType union)
 * - Used by UI maps (icons/labels/colors)
 * - Used by public API endpoint (serializable "official list")
 */

import type { Icon } from '@tabler/icons-react';
import {
  IconMail,
  IconWorld,
  IconServer,
  IconUser,
  IconAt,
  IconPhone,
  IconBuildingSkyscraper,
  IconFingerprint,
  IconKey,
  IconFileText,
  IconNote,
  IconPhoto,
  IconVideo,
  IconMapPin,
  IconWallet,
  IconArrowsExchange,
  IconCircle,
  IconLink,
  IconRobot,
  IconMap2,
  IconUsers,
  IconSpeakerphone,
  IconLayoutGrid,
  IconHeading,
  IconNetwork,
  IconDeviceMobile,
  IconCpu,
  IconShieldLock,
  IconId,
  IconAddressBook,
  IconMicrophone,
  IconLock,
  IconCreditCard,
  IconBuildingBank,
  IconCertificate,
  IconWorldWww,
  IconServerBolt,
  IconBrandGithub,
  IconBrandGitlab,
  IconBrandLinkedin,
  IconBrandTwitter,
  IconBrandYoutube,
  IconBrandTiktok,
  IconBrandReddit,
  IconBrandDiscord,
  IconBrandWhatsapp,
  IconBrandSlack,
  IconFileTypePdf,
  IconFileTypeDocx,
  IconFileTypeXls,
  IconFileTypeTxt,
  IconFileTypeCsv,
  IconBraces,
  IconAlertTriangle,
  IconDatabaseSearch,
  IconMusic
} from '@tabler/icons-react';

import {
  entityTypes,
  EntityType,
  nodeTypes,
  NodeType,
  NodeKind
} from './entity-types';

export {
  entityTypes,
  type EntityType,
  nodeTypes,
  type NodeType,
  type NodeKind
};

export interface NodeTypeDefinition {
  type: NodeType;
  kind: NodeKind;
  label: string;
  category: string;
  subcategory?: string;
  iconKey: string;
  icon: Icon;
  /**
   * If set and NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY is provided,
   * the UI/API will prefer `https://img.logo.dev/<domain>?token=...` as logoUrl.
   * Example: "shopify.com", "github.com", "instagram.com".
   */
  logoDevDomain?: string;
  /**
   * If false, node type exists but is NOT offered in manual add menus.
   * Still allowed from transforms/imports.
   */
  manualAdd: boolean;
  /**
   * Hex color used in the graph editor palette/minimap.
   */
  colorHex: string;
  /**
   * Tailwind classes used by node cards/badges.
   * Kept explicit to avoid Tailwind JIT issues with dynamic class names.
   */
  ui: {
    headerBg: string;
    headerText: string;
    bodyBg: string;
    borderColor: string;
    badge: {
      bg: string;
      text: string;
      border: string;
      darkBg: string;
    };
  };
  /**
   * Creation defaults for the graph editor.
   */
  defaults?: {
    isResizable?: boolean;
    initialSize?: { width: number; height: number };
    zIndex?: number;
    label?: string;
    metadata?: Record<string, unknown>;
  };
}

function def(d: NodeTypeDefinition): NodeTypeDefinition {
  return d;
}

export const nodeTypeDefinitions = [
  def({
    type: 'email',
    kind: 'entity',
    label: 'Email',
    category: 'Identity',
    iconKey: 'mail',
    icon: IconMail,
    manualAdd: true,
    colorHex: '#60a5fa',
    ui: {
      headerBg: 'bg-blue-500/10 dark:bg-blue-500/20',
      headerText: 'text-blue-600 dark:text-blue-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-blue-200 dark:border-blue-800',
      badge: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        border: 'border-blue-300',
        darkBg: 'dark:bg-blue-950/50'
      }
    }
  }),
  def({
    type: 'domain',
    kind: 'entity',
    label: 'Domain',
    category: 'Network',
    iconKey: 'world',
    icon: IconWorld,
    manualAdd: true,
    colorHex: '#34d399',
    ui: {
      headerBg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
      headerText: 'text-emerald-600 dark:text-emerald-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-emerald-200 dark:border-emerald-800',
      badge: {
        bg: 'bg-emerald-100',
        text: 'text-emerald-700',
        border: 'border-emerald-300',
        darkBg: 'dark:bg-emerald-950/50'
      }
    }
  }),
  def({
    type: 'ip',
    kind: 'entity',
    label: 'IP Address',
    category: 'Network',
    iconKey: 'server',
    icon: IconServer,
    manualAdd: true,
    colorHex: '#fbbf24',
    ui: {
      headerBg: 'bg-amber-500/10 dark:bg-amber-500/20',
      headerText: 'text-amber-600 dark:text-amber-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-amber-200 dark:border-amber-800',
      badge: {
        bg: 'bg-amber-100',
        text: 'text-amber-700',
        border: 'border-amber-300',
        darkBg: 'dark:bg-amber-950/50'
      }
    }
  }),
  def({
    type: 'person',
    kind: 'entity',
    label: 'Person',
    category: 'Identity',
    iconKey: 'user',
    icon: IconUser,
    manualAdd: true,
    colorHex: '#c084fc',
    ui: {
      headerBg: 'bg-purple-500/10 dark:bg-purple-500/20',
      headerText: 'text-purple-600 dark:text-purple-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-purple-200 dark:border-purple-800',
      badge: {
        bg: 'bg-purple-100',
        text: 'text-purple-700',
        border: 'border-purple-300',
        darkBg: 'dark:bg-purple-950/50'
      }
    }
  }),
  def({
    type: 'username',
    kind: 'entity',
    label: 'Username',
    category: 'Identity',
    iconKey: 'at',
    icon: IconAt,
    manualAdd: true,
    colorHex: '#f472b6',
    ui: {
      headerBg: 'bg-pink-500/10 dark:bg-pink-500/20',
      headerText: 'text-pink-600 dark:text-pink-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-pink-200 dark:border-pink-800',
      badge: {
        bg: 'bg-pink-100',
        text: 'text-pink-700',
        border: 'border-pink-300',
        darkBg: 'dark:bg-pink-950/50'
      }
    }
  }),
  def({
    type: 'phone',
    kind: 'entity',
    label: 'Phone',
    category: 'Identity',
    iconKey: 'phone',
    icon: IconPhone,
    manualAdd: true,
    colorHex: '#22d3ee',
    ui: {
      headerBg: 'bg-cyan-500/10 dark:bg-cyan-500/20',
      headerText: 'text-cyan-600 dark:text-cyan-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-cyan-200 dark:border-cyan-800',
      badge: {
        bg: 'bg-cyan-100',
        text: 'text-cyan-700',
        border: 'border-cyan-300',
        darkBg: 'dark:bg-cyan-950/50'
      }
    }
  }),
  def({
    type: 'organization',
    kind: 'entity',
    label: 'Organization',
    category: 'Identity',
    iconKey: 'building',
    icon: IconBuildingSkyscraper,
    manualAdd: true,
    colorHex: '#818cf8',
    ui: {
      headerBg: 'bg-indigo-500/10 dark:bg-indigo-500/20',
      headerText: 'text-indigo-600 dark:text-indigo-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-indigo-200 dark:border-indigo-800',
      badge: {
        bg: 'bg-indigo-100',
        text: 'text-indigo-700',
        border: 'border-indigo-300',
        darkBg: 'dark:bg-indigo-950/50'
      }
    }
  }),
  def({
    type: 'hash',
    kind: 'entity',
    label: 'Hash',
    category: 'Technical',
    iconKey: 'fingerprint',
    icon: IconFingerprint,
    manualAdd: true,
    colorHex: '#f87171',
    ui: {
      headerBg: 'bg-red-500/10 dark:bg-red-500/20',
      headerText: 'text-red-600 dark:text-red-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-red-200 dark:border-red-800',
      badge: {
        bg: 'bg-red-100',
        text: 'text-red-700',
        border: 'border-red-300',
        darkBg: 'dark:bg-red-950/50'
      }
    }
  }),
  def({
    type: 'credential',
    kind: 'entity',
    label: 'Credential',
    category: 'Technical',
    iconKey: 'key',
    icon: IconKey,
    manualAdd: true,
    colorHex: '#fb923c',
    ui: {
      headerBg: 'bg-orange-500/10 dark:bg-orange-500/20',
      headerText: 'text-orange-600 dark:text-orange-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-orange-200 dark:border-orange-800',
      badge: {
        bg: 'bg-orange-100',
        text: 'text-orange-700',
        border: 'border-orange-300',
        darkBg: 'dark:bg-orange-950/50'
      }
    }
  }),

  // Social
  def({
    type: 'instagram_user',
    kind: 'entity',
    label: 'User',
    category: 'Social',
    subcategory: 'Instagram',
    iconKey: 'user',
    icon: IconUser,
    manualAdd: true,
    colorHex: '#E1306C',
    logoDevDomain: 'instagram.com',
    ui: {
      headerBg: 'bg-rose-500/10 dark:bg-rose-500/20',
      headerText: 'text-rose-600 dark:text-rose-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-rose-200 dark:border-rose-800',
      badge: {
        bg: 'bg-rose-100',
        text: 'text-rose-700',
        border: 'border-rose-300',
        darkBg: 'dark:bg-rose-950/50'
      }
    }
  }),
  def({
    type: 'instagram_post',
    kind: 'entity',
    label: 'Post',
    category: 'Social',
    subcategory: 'Instagram',
    iconKey: 'brand-instagram',
    icon: IconBrandTwitter,
    logoDevDomain: 'instagram.com',
    manualAdd: true,
    colorHex: '#E1306C',
    ui: {
      headerBg: 'bg-rose-500/10 dark:bg-rose-500/20',
      headerText: 'text-rose-600 dark:text-rose-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-rose-200 dark:border-rose-800',
      badge: {
        bg: 'bg-rose-100',
        text: 'text-rose-700',
        border: 'border-rose-300',
        darkBg: 'dark:bg-rose-950/50'
      }
    }
  }),
  def({
    type: 'telegram_user',
    kind: 'entity',
    label: 'User',
    category: 'Social',
    subcategory: 'Telegram',
    iconKey: 'user',
    icon: IconUser,
    manualAdd: true,
    colorHex: '#0088cc',
    logoDevDomain: 'telegram.org',
    ui: {
      headerBg: 'bg-sky-500/10 dark:bg-sky-500/20',
      headerText: 'text-sky-600 dark:text-sky-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-sky-200 dark:border-sky-800',
      badge: {
        bg: 'bg-sky-100',
        text: 'text-sky-700',
        border: 'border-sky-300',
        darkBg: 'dark:bg-sky-950/50'
      }
    }
  }),
  def({
    type: 'telegram_channel',
    kind: 'entity',
    label: 'Channel',
    category: 'Social',
    subcategory: 'Telegram',
    iconKey: 'speakerphone',
    icon: IconSpeakerphone,
    manualAdd: true,
    colorHex: '#0088cc',
    logoDevDomain: 'telegram.org',
    ui: {
      headerBg: 'bg-sky-500/10 dark:bg-sky-500/20',
      headerText: 'text-sky-600 dark:text-sky-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-sky-200 dark:border-sky-800',
      badge: {
        bg: 'bg-sky-100',
        text: 'text-sky-700',
        border: 'border-sky-300',
        darkBg: 'dark:bg-sky-950/50'
      }
    }
  }),
  def({
    type: 'telegram_group',
    kind: 'entity',
    label: 'Group',
    category: 'Social',
    subcategory: 'Telegram',
    iconKey: 'users',
    icon: IconUsers,
    manualAdd: true,
    colorHex: '#0088cc',
    logoDevDomain: 'telegram.org',
    ui: {
      headerBg: 'bg-sky-500/10 dark:bg-sky-500/20',
      headerText: 'text-sky-600 dark:text-sky-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-sky-200 dark:border-sky-800',
      badge: {
        bg: 'bg-sky-100',
        text: 'text-sky-700',
        border: 'border-sky-300',
        darkBg: 'dark:bg-sky-950/50'
      }
    }
  }),
  def({
    type: 'telegram_bot',
    kind: 'entity',
    label: 'Bot',
    category: 'Social',
    subcategory: 'Telegram',
    iconKey: 'speakerphone',
    icon: IconSpeakerphone,
    logoDevDomain: 'telegram.org',
    manualAdd: true,
    colorHex: '#0088cc',
    ui: {
      headerBg: 'bg-sky-500/10 dark:bg-sky-500/20',
      headerText: 'text-sky-600 dark:text-sky-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-sky-200 dark:border-sky-800',
      badge: {
        bg: 'bg-sky-100',
        text: 'text-sky-700',
        border: 'border-sky-300',
        darkBg: 'dark:bg-sky-950/50'
      }
    }
  }),
  def({
    type: 'facebook_user',
    kind: 'entity',
    label: 'User',
    category: 'Social',
    subcategory: 'Facebook',
    iconKey: 'user',
    icon: IconUser,
    manualAdd: true,
    colorHex: '#1877F2',
    logoDevDomain: 'facebook.com',
    ui: {
      headerBg: 'bg-blue-500/10 dark:bg-blue-500/20',
      headerText: 'text-blue-600 dark:text-blue-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-blue-200 dark:border-blue-800',
      badge: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        border: 'border-blue-300',
        darkBg: 'dark:bg-blue-950/50'
      }
    }
  }),
  def({
    type: 'facebook_group',
    kind: 'entity',
    label: 'Group',
    category: 'Social',
    subcategory: 'Facebook',
    iconKey: 'users',
    icon: IconUsers,
    manualAdd: true,
    colorHex: '#1877F2',
    logoDevDomain: 'facebook.com',
    ui: {
      headerBg: 'bg-blue-500/10 dark:bg-blue-500/20',
      headerText: 'text-blue-600 dark:text-blue-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-blue-200 dark:border-blue-800',
      badge: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        border: 'border-blue-300',
        darkBg: 'dark:bg-blue-950/50'
      }
    }
  }),
  def({
    type: 'twitter_user',
    kind: 'entity',
    label: 'User',
    category: 'Social',
    subcategory: 'X (Twitter)',
    iconKey: 'brand-twitter',
    icon: IconBrandTwitter,
    logoDevDomain: 'x.com',
    manualAdd: true,
    colorHex: '#1D9BF0',
    ui: {
      headerBg: 'bg-sky-500/10 dark:bg-sky-500/20',
      headerText: 'text-sky-600 dark:text-sky-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-sky-200 dark:border-sky-800',
      badge: {
        bg: 'bg-sky-100',
        text: 'text-sky-700',
        border: 'border-sky-300',
        darkBg: 'dark:bg-sky-950/50'
      }
    }
  }),
  def({
    type: 'twitter_post',
    kind: 'entity',
    label: 'Post',
    category: 'Social',
    subcategory: 'X (Twitter)',
    iconKey: 'brand-twitter',
    icon: IconBrandTwitter,
    logoDevDomain: 'x.com',
    manualAdd: true,
    colorHex: '#1D9BF0',
    ui: {
      headerBg: 'bg-sky-500/10 dark:bg-sky-500/20',
      headerText: 'text-sky-600 dark:text-sky-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-sky-200 dark:border-sky-800',
      badge: {
        bg: 'bg-sky-100',
        text: 'text-sky-700',
        border: 'border-sky-300',
        darkBg: 'dark:bg-sky-950/50'
      }
    }
  }),
  def({
    type: 'linkedin_profile',
    kind: 'entity',
    label: 'Profile',
    category: 'Social',
    subcategory: 'LinkedIn',
    iconKey: 'brand-linkedin',
    icon: IconBrandLinkedin,
    logoDevDomain: 'linkedin.com',
    manualAdd: true,
    colorHex: '#0A66C2',
    ui: {
      headerBg: 'bg-blue-500/10 dark:bg-blue-500/20',
      headerText: 'text-blue-600 dark:text-blue-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-blue-200 dark:border-blue-800',
      badge: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        border: 'border-blue-300',
        darkBg: 'dark:bg-blue-950/50'
      }
    }
  }),
  def({
    type: 'github_user',
    kind: 'entity',
    label: 'User',
    category: 'Services',
    subcategory: 'GitHub',
    iconKey: 'brand-github',
    icon: IconBrandGithub,
    logoDevDomain: 'github.com',
    manualAdd: true,
    colorHex: '#94a3b8',
    ui: {
      headerBg: 'bg-slate-500/10 dark:bg-slate-500/20',
      headerText: 'text-slate-600 dark:text-slate-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-slate-200 dark:border-slate-800',
      badge: {
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        border: 'border-slate-300',
        darkBg: 'dark:bg-slate-950/50'
      }
    }
  }),
  def({
    type: 'github_repo',
    kind: 'entity',
    label: 'Repository',
    category: 'Services',
    subcategory: 'GitHub',
    iconKey: 'brand-github',
    icon: IconBrandGithub,
    logoDevDomain: 'github.com',
    manualAdd: true,
    colorHex: '#94a3b8',
    ui: {
      headerBg: 'bg-slate-500/10 dark:bg-slate-500/20',
      headerText: 'text-slate-600 dark:text-slate-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-slate-200 dark:border-slate-800',
      badge: {
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        border: 'border-slate-300',
        darkBg: 'dark:bg-slate-950/50'
      }
    }
  }),
  def({
    type: 'gitlab_user',
    kind: 'entity',
    label: 'User',
    category: 'Services',
    subcategory: 'GitLab',
    iconKey: 'brand-gitlab',
    icon: IconBrandGitlab,
    logoDevDomain: 'gitlab.com',
    manualAdd: true,
    colorHex: '#fb923c',
    ui: {
      headerBg: 'bg-orange-500/10 dark:bg-orange-500/20',
      headerText: 'text-orange-600 dark:text-orange-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-orange-200 dark:border-orange-800',
      badge: {
        bg: 'bg-orange-100',
        text: 'text-orange-700',
        border: 'border-orange-300',
        darkBg: 'dark:bg-orange-950/50'
      }
    }
  }),
  def({
    type: 'youtube_channel',
    kind: 'entity',
    label: 'Channel',
    category: 'Social',
    subcategory: 'YouTube',
    iconKey: 'brand-youtube',
    icon: IconBrandYoutube,
    logoDevDomain: 'youtube.com',
    manualAdd: true,
    colorHex: '#FF0000',
    ui: {
      headerBg: 'bg-red-500/10 dark:bg-red-500/20',
      headerText: 'text-red-600 dark:text-red-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-red-200 dark:border-red-800',
      badge: {
        bg: 'bg-red-100',
        text: 'text-red-700',
        border: 'border-red-300',
        darkBg: 'dark:bg-red-950/50'
      }
    }
  }),
  def({
    type: 'youtube_video',
    kind: 'entity',
    label: 'Video',
    category: 'Social',
    subcategory: 'YouTube',
    iconKey: 'brand-youtube',
    icon: IconBrandYoutube,
    logoDevDomain: 'youtube.com',
    manualAdd: true,
    colorHex: '#FF0000',
    ui: {
      headerBg: 'bg-red-500/10 dark:bg-red-500/20',
      headerText: 'text-red-600 dark:text-red-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-red-200 dark:border-red-800',
      badge: {
        bg: 'bg-red-100',
        text: 'text-red-700',
        border: 'border-red-300',
        darkBg: 'dark:bg-red-950/50'
      }
    },
    defaults: { isResizable: true, initialSize: { width: 280, height: 200 } }
  }),
  def({
    type: 'tiktok_user',
    kind: 'entity',
    label: 'User',
    category: 'Social',
    subcategory: 'TikTok',
    iconKey: 'brand-tiktok',
    icon: IconBrandTiktok,
    logoDevDomain: 'tiktok.com',
    manualAdd: true,
    colorHex: '#00F2EA',
    ui: {
      headerBg: 'bg-cyan-500/10 dark:bg-cyan-500/20',
      headerText: 'text-cyan-600 dark:text-cyan-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-cyan-200 dark:border-cyan-800',
      badge: {
        bg: 'bg-cyan-100',
        text: 'text-cyan-700',
        border: 'border-cyan-300',
        darkBg: 'dark:bg-cyan-950/50'
      }
    }
  }),
  def({
    type: 'tiktok_video',
    kind: 'entity',
    label: 'Video',
    category: 'Social',
    subcategory: 'TikTok',
    iconKey: 'brand-tiktok',
    icon: IconBrandTiktok,
    logoDevDomain: 'tiktok.com',
    manualAdd: true,
    colorHex: '#00F2EA',
    ui: {
      headerBg: 'bg-cyan-500/10 dark:bg-cyan-500/20',
      headerText: 'text-cyan-600 dark:text-cyan-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-cyan-200 dark:border-cyan-800',
      badge: {
        bg: 'bg-cyan-100',
        text: 'text-cyan-700',
        border: 'border-cyan-300',
        darkBg: 'dark:bg-cyan-950/50'
      }
    },
    defaults: { isResizable: true, initialSize: { width: 280, height: 200 } }
  }),
  def({
    type: 'reddit_user',
    kind: 'entity',
    label: 'User',
    category: 'Social',
    subcategory: 'Reddit',
    iconKey: 'brand-reddit',
    icon: IconBrandReddit,
    logoDevDomain: 'reddit.com',
    manualAdd: true,
    colorHex: '#FF4500',
    ui: {
      headerBg: 'bg-orange-500/10 dark:bg-orange-500/20',
      headerText: 'text-orange-600 dark:text-orange-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-orange-200 dark:border-orange-800',
      badge: {
        bg: 'bg-orange-100',
        text: 'text-orange-700',
        border: 'border-orange-300',
        darkBg: 'dark:bg-orange-950/50'
      }
    }
  }),
  def({
    type: 'reddit_post',
    kind: 'entity',
    label: 'Post',
    category: 'Social',
    subcategory: 'Reddit',
    iconKey: 'brand-reddit',
    icon: IconBrandReddit,
    logoDevDomain: 'reddit.com',
    manualAdd: true,
    colorHex: '#FF4500',
    ui: {
      headerBg: 'bg-orange-500/10 dark:bg-orange-500/20',
      headerText: 'text-orange-600 dark:text-orange-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-orange-200 dark:border-orange-800',
      badge: {
        bg: 'bg-orange-100',
        text: 'text-orange-700',
        border: 'border-orange-300',
        darkBg: 'dark:bg-orange-950/50'
      }
    }
  }),
  def({
    type: 'discord_user',
    kind: 'entity',
    label: 'User',
    category: 'Social',
    subcategory: 'Discord',
    iconKey: 'brand-discord',
    icon: IconBrandDiscord,
    logoDevDomain: 'discord.com',
    manualAdd: true,
    colorHex: '#5865F2',
    ui: {
      headerBg: 'bg-indigo-500/10 dark:bg-indigo-500/20',
      headerText: 'text-indigo-600 dark:text-indigo-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-indigo-200 dark:border-indigo-800',
      badge: {
        bg: 'bg-indigo-100',
        text: 'text-indigo-700',
        border: 'border-indigo-300',
        darkBg: 'dark:bg-indigo-950/50'
      }
    }
  }),
  def({
    type: 'discord_server',
    kind: 'entity',
    label: 'Server',
    category: 'Social',
    subcategory: 'Discord',
    iconKey: 'brand-discord',
    icon: IconBrandDiscord,
    logoDevDomain: 'discord.com',
    manualAdd: true,
    colorHex: '#5865F2',
    ui: {
      headerBg: 'bg-indigo-500/10 dark:bg-indigo-500/20',
      headerText: 'text-indigo-600 dark:text-indigo-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-indigo-200 dark:border-indigo-800',
      badge: {
        bg: 'bg-indigo-100',
        text: 'text-indigo-700',
        border: 'border-indigo-300',
        darkBg: 'dark:bg-indigo-950/50'
      }
    }
  }),
  def({
    type: 'whatsapp_number',
    kind: 'entity',
    label: 'Number',
    category: 'Communication',
    subcategory: 'WhatsApp',
    iconKey: 'brand-whatsapp',
    icon: IconBrandWhatsapp,
    logoDevDomain: 'whatsapp.com',
    manualAdd: true,
    colorHex: '#25D366',
    ui: {
      headerBg: 'bg-green-500/10 dark:bg-green-500/20',
      headerText: 'text-green-600 dark:text-green-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-green-200 dark:border-green-800',
      badge: {
        bg: 'bg-green-100',
        text: 'text-green-700',
        border: 'border-green-300',
        darkBg: 'dark:bg-green-950/50'
      }
    }
  }),
  def({
    type: 'signal_number',
    kind: 'entity',
    label: 'Number',
    category: 'Communication',
    subcategory: 'Signal',
    iconKey: 'shield-lock',
    icon: IconShieldLock,
    manualAdd: true,
    colorHex: '#3A76F0',
    ui: {
      headerBg: 'bg-blue-500/10 dark:bg-blue-500/20',
      headerText: 'text-blue-600 dark:text-blue-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-blue-200 dark:border-blue-800',
      badge: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        border: 'border-blue-300',
        darkBg: 'dark:bg-blue-950/50'
      }
    }
  }),
  def({
    type: 'slack_workspace',
    kind: 'entity',
    label: 'Workspace',
    category: 'Services',
    subcategory: 'Slack',
    iconKey: 'brand-slack',
    icon: IconBrandSlack,
    logoDevDomain: 'slack.com',
    manualAdd: true,
    colorHex: '#4A154B',
    ui: {
      headerBg: 'bg-fuchsia-500/10 dark:bg-fuchsia-500/20',
      headerText: 'text-fuchsia-600 dark:text-fuchsia-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-fuchsia-200 dark:border-fuchsia-800',
      badge: {
        bg: 'bg-fuchsia-100',
        text: 'text-fuchsia-700',
        border: 'border-fuchsia-300',
        darkBg: 'dark:bg-fuchsia-950/50'
      }
    }
  }),
  def({
    type: 'slack_channel',
    kind: 'entity',
    label: 'Channel',
    category: 'Services',
    subcategory: 'Slack',
    iconKey: 'brand-slack',
    icon: IconBrandSlack,
    logoDevDomain: 'slack.com',
    manualAdd: true,
    colorHex: '#4A154B',
    ui: {
      headerBg: 'bg-fuchsia-500/10 dark:bg-fuchsia-500/20',
      headerText: 'text-fuchsia-600 dark:text-fuchsia-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-fuchsia-200 dark:border-fuchsia-800',
      badge: {
        bg: 'bg-fuchsia-100',
        text: 'text-fuchsia-700',
        border: 'border-fuchsia-300',
        darkBg: 'dark:bg-fuchsia-950/50'
      }
    }
  }),
  def({
    type: 'social',
    kind: 'entity',
    label: 'Generic Profile',
    category: 'Social',
    subcategory: 'Generic',
    iconKey: 'at',
    icon: IconAt,
    manualAdd: true,
    colorHex: '#38bdf8',
    ui: {
      headerBg: 'bg-sky-500/10 dark:bg-sky-500/20',
      headerText: 'text-sky-600 dark:text-sky-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-sky-200 dark:border-sky-800',
      badge: {
        bg: 'bg-sky-100',
        text: 'text-sky-700',
        border: 'border-sky-300',
        darkBg: 'dark:bg-sky-950/50'
      }
    }
  }),

  // Content
  def({
    type: 'document',
    kind: 'entity',
    label: 'Document',
    category: 'File',
    subcategory: 'Document',
    iconKey: 'file-text',
    icon: IconFileText,
    manualAdd: true,
    colorHex: '#94a3b8',
    ui: {
      headerBg: 'bg-slate-500/10 dark:bg-slate-500/20',
      headerText: 'text-slate-600 dark:text-slate-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-slate-200 dark:border-slate-800',
      badge: {
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        border: 'border-slate-300',
        darkBg: 'dark:bg-slate-950/50'
      }
    },
    defaults: {
      initialSize: { width: 140, height: 160 }
    }
  }),
  def({
    type: 'pdf',
    kind: 'entity',
    label: 'PDF',
    category: 'File',
    subcategory: 'Document',
    iconKey: 'file-type-pdf',
    icon: IconFileTypePdf,
    manualAdd: true,
    colorHex: '#ef4444',
    ui: {
      headerBg: 'bg-red-500/10 dark:bg-red-500/20',
      headerText: 'text-red-600 dark:text-red-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-red-200 dark:border-red-800',
      badge: {
        bg: 'bg-red-100',
        text: 'text-red-700',
        border: 'border-red-300',
        darkBg: 'dark:bg-red-950/50'
      }
    },
    defaults: {
      isResizable: true,
      initialSize: { width: 280, height: 360 }
    }
  }),
  def({
    type: 'docx',
    kind: 'entity',
    label: 'Word',
    category: 'File',
    subcategory: 'Document',
    iconKey: 'file-type-docx',
    icon: IconFileTypeDocx,
    manualAdd: true,
    colorHex: '#2563eb',
    ui: {
      headerBg: 'bg-blue-600/10 dark:bg-blue-600/20',
      headerText: 'text-blue-600 dark:text-blue-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-blue-200 dark:border-blue-800',
      badge: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        border: 'border-blue-300',
        darkBg: 'dark:bg-blue-950/50'
      }
    },
    defaults: {
      initialSize: { width: 140, height: 160 }
    }
  }),
  def({
    type: 'xlsx',
    kind: 'entity',
    label: 'Excel',
    category: 'File',
    subcategory: 'Document',
    iconKey: 'file-type-xls',
    icon: IconFileTypeXls,
    manualAdd: true,
    colorHex: '#16a34a',
    ui: {
      headerBg: 'bg-green-600/10 dark:bg-green-600/20',
      headerText: 'text-green-600 dark:text-green-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-green-200 dark:border-green-800',
      badge: {
        bg: 'bg-green-100',
        text: 'text-green-700',
        border: 'border-green-300',
        darkBg: 'dark:bg-green-950/50'
      }
    },
    defaults: {
      initialSize: { width: 140, height: 160 }
    }
  }),
  def({
    type: 'txt',
    kind: 'entity',
    label: 'Text File',
    category: 'File',
    subcategory: 'Document',
    iconKey: 'file-type-txt',
    icon: IconFileTypeTxt,
    manualAdd: true,
    colorHex: '#64748b',
    ui: {
      headerBg: 'bg-slate-500/10 dark:bg-slate-500/20',
      headerText: 'text-slate-600 dark:text-slate-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-slate-200 dark:border-slate-800',
      badge: {
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        border: 'border-slate-300',
        darkBg: 'dark:bg-slate-950/50'
      }
    },
    defaults: {
      initialSize: { width: 140, height: 160 }
    }
  }),
  def({
    type: 'csv',
    kind: 'entity',
    label: 'CSV',
    category: 'File',
    subcategory: 'Document',
    iconKey: 'file-type-csv',
    icon: IconFileTypeCsv,
    manualAdd: true,
    colorHex: '#059669',
    ui: {
      headerBg: 'bg-emerald-600/10 dark:bg-emerald-600/20',
      headerText: 'text-emerald-600 dark:text-emerald-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-emerald-200 dark:border-emerald-800',
      badge: {
        bg: 'bg-emerald-100',
        text: 'text-emerald-700',
        border: 'border-emerald-300',
        darkBg: 'dark:bg-emerald-950/50'
      }
    },
    defaults: {
      initialSize: { width: 140, height: 160 }
    }
  }),
  def({
    type: 'json',
    kind: 'entity',
    label: 'JSON',
    category: 'File',
    subcategory: 'Document',
    iconKey: 'braces',
    icon: IconBraces,
    manualAdd: true,
    colorHex: '#eab308',
    ui: {
      headerBg: 'bg-yellow-500/10 dark:bg-yellow-500/20',
      headerText: 'text-yellow-600 dark:text-yellow-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-yellow-200 dark:border-yellow-800',
      badge: {
        bg: 'bg-yellow-100',
        text: 'text-yellow-700',
        border: 'border-yellow-300',
        darkBg: 'dark:bg-yellow-950/50'
      }
    },
    defaults: {
      initialSize: { width: 140, height: 160 }
    }
  }),
  def({
    type: 'note',
    kind: 'entity',
    label: 'Note',
    category: 'Content',
    iconKey: 'note',
    icon: IconNote,
    manualAdd: true,
    colorHex: '#facc15',
    ui: {
      headerBg: 'bg-yellow-500/10 dark:bg-yellow-500/20',
      headerText: 'text-yellow-600 dark:text-yellow-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-yellow-200 dark:border-yellow-800',
      badge: {
        bg: 'bg-yellow-100',
        text: 'text-yellow-700',
        border: 'border-yellow-300',
        darkBg: 'dark:bg-yellow-950/50'
      }
    },
    defaults: {
      isResizable: true,
      initialSize: { width: 350, height: 250 }
    }
  }),
  def({
    type: 'media_url',
    kind: 'entity',
    label: 'Media URL',
    category: 'Content',
    iconKey: 'photo',
    icon: IconPhoto,
    manualAdd: true,
    colorHex: '#a8a29e',
    ui: {
      headerBg: 'bg-stone-500/10 dark:bg-stone-500/20',
      headerText: 'text-stone-600 dark:text-stone-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-stone-200 dark:border-stone-800',
      badge: {
        bg: 'bg-stone-100',
        text: 'text-stone-700',
        border: 'border-stone-300',
        darkBg: 'dark:bg-stone-950/50'
      }
    },
    defaults: {
      isResizable: true,
      initialSize: { width: 280, height: 200 }
    }
  }),

  // Location
  def({
    type: 'location',
    kind: 'entity',
    label: 'Location',
    category: 'Location',
    iconKey: 'map-pin',
    icon: IconMapPin,
    manualAdd: true,
    colorHex: '#fb7185',
    ui: {
      headerBg: 'bg-rose-500/10 dark:bg-rose-500/20',
      headerText: 'text-rose-600 dark:text-rose-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-rose-200 dark:border-rose-800',
      badge: {
        bg: 'bg-rose-100',
        text: 'text-rose-700',
        border: 'border-rose-300',
        darkBg: 'dark:bg-rose-950/50'
      }
    }
  }),
  def({
    type: 'address',
    kind: 'entity',
    label: 'Address',
    category: 'Location',
    iconKey: 'address-book',
    icon: IconAddressBook,
    manualAdd: true,
    colorHex: '#fb7185',
    ui: {
      headerBg: 'bg-rose-500/10 dark:bg-rose-500/20',
      headerText: 'text-rose-600 dark:text-rose-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-rose-200 dark:border-rose-800',
      badge: {
        bg: 'bg-rose-100',
        text: 'text-rose-700',
        border: 'border-rose-300',
        darkBg: 'dark:bg-rose-950/50'
      }
    }
  }),
  def({
    type: 'maps',
    kind: 'entity',
    label: 'Map',
    category: 'Location',
    iconKey: 'map2',
    icon: IconMap2,
    manualAdd: true,
    colorHex: '#22c55e',
    ui: {
      headerBg: 'bg-green-500/10 dark:bg-green-500/20',
      headerText: 'text-green-600 dark:text-green-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-green-200 dark:border-green-800',
      badge: {
        bg: 'bg-green-100',
        text: 'text-green-700',
        border: 'border-green-300',
        darkBg: 'dark:bg-green-950/50'
      }
    },
    defaults: {
      isResizable: true,
      initialSize: { width: 320, height: 240 }
    }
  }),

  // Blockchain
  def({
    type: 'wallet',
    kind: 'entity',
    label: 'Wallet',
    category: 'Blockchain',
    subcategory: 'Wallet',
    iconKey: 'wallet',
    icon: IconWallet,
    manualAdd: true,
    colorHex: '#f59e0b',
    ui: {
      headerBg: 'bg-amber-500/10 dark:bg-amber-500/20',
      headerText: 'text-amber-600 dark:text-amber-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-amber-200 dark:border-amber-800',
      badge: {
        bg: 'bg-amber-100',
        text: 'text-amber-700',
        border: 'border-amber-300',
        darkBg: 'dark:bg-amber-950/50'
      }
    }
  }),
  def({
    type: 'wallet_eth',
    kind: 'entity',
    label: 'ETH Wallet',
    category: 'Blockchain',
    subcategory: 'Wallet',
    iconKey: 'wallet',
    icon: IconWallet,
    manualAdd: true,
    colorHex: '#6366f1',
    ui: {
      headerBg: 'bg-indigo-500/10 dark:bg-indigo-500/20',
      headerText: 'text-indigo-600 dark:text-indigo-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-indigo-200 dark:border-indigo-800',
      badge: {
        bg: 'bg-indigo-100',
        text: 'text-indigo-700',
        border: 'border-indigo-300',
        darkBg: 'dark:bg-indigo-950/50'
      }
    }
  }),
  def({
    type: 'wallet_btc',
    kind: 'entity',
    label: 'BTC Wallet',
    category: 'Blockchain',
    subcategory: 'Wallet',
    iconKey: 'wallet',
    icon: IconWallet,
    manualAdd: true,
    colorHex: '#f97316',
    ui: {
      headerBg: 'bg-orange-500/10 dark:bg-orange-500/20',
      headerText: 'text-orange-600 dark:text-orange-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-orange-200 dark:border-orange-800',
      badge: {
        bg: 'bg-orange-100',
        text: 'text-orange-700',
        border: 'border-orange-300',
        darkBg: 'dark:bg-orange-950/50'
      }
    }
  }),
  def({
    type: 'wallet_ltc',
    kind: 'entity',
    label: 'LTC Wallet',
    category: 'Blockchain',
    subcategory: 'Wallet',
    iconKey: 'wallet',
    icon: IconWallet,
    manualAdd: true,
    colorHex: '#94a3b8',
    ui: {
      headerBg: 'bg-slate-500/10 dark:bg-slate-500/20',
      headerText: 'text-slate-600 dark:text-slate-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-slate-200 dark:border-slate-800',
      badge: {
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        border: 'border-slate-300',
        darkBg: 'dark:bg-slate-950/50'
      }
    }
  }),
  def({
    type: 'wallet_tron',
    kind: 'entity',
    label: 'TRON Wallet',
    category: 'Blockchain',
    subcategory: 'Wallet',
    iconKey: 'wallet',
    icon: IconWallet,
    manualAdd: true,
    colorHex: '#ef4444',
    ui: {
      headerBg: 'bg-red-500/10 dark:bg-red-500/20',
      headerText: 'text-red-600 dark:text-red-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-red-200 dark:border-red-800',
      badge: {
        bg: 'bg-red-100',
        text: 'text-red-700',
        border: 'border-red-300',
        darkBg: 'dark:bg-red-950/50'
      }
    }
  }),
  def({
    type: 'wallet_solana',
    kind: 'entity',
    label: 'Solana Wallet',
    category: 'Blockchain',
    subcategory: 'Wallet',
    iconKey: 'wallet',
    icon: IconWallet,
    manualAdd: true,
    colorHex: '#22c55e',
    ui: {
      headerBg: 'bg-green-500/10 dark:bg-green-500/20',
      headerText: 'text-green-600 dark:text-green-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-green-200 dark:border-green-800',
      badge: {
        bg: 'bg-green-100',
        text: 'text-green-700',
        border: 'border-green-300',
        darkBg: 'dark:bg-green-950/50'
      }
    }
  }),
  def({
    type: 'transaction',
    kind: 'entity',
    label: 'Transaction',
    category: 'Blockchain',
    iconKey: 'arrows-exchange',
    icon: IconArrowsExchange,
    manualAdd: true,
    colorHex: '#a3e635',
    ui: {
      headerBg: 'bg-lime-500/10 dark:bg-lime-500/20',
      headerText: 'text-lime-600 dark:text-lime-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-lime-200 dark:border-lime-800',
      badge: {
        bg: 'bg-lime-100',
        text: 'text-lime-700',
        border: 'border-lime-300',
        darkBg: 'dark:bg-lime-950/50'
      }
    }
  }),
  def({
    type: 'exchange',
    kind: 'entity',
    label: 'Exchange',
    category: 'Blockchain',
    iconKey: 'building',
    icon: IconBuildingSkyscraper,
    manualAdd: true,
    colorHex: '#eab308',
    ui: {
      headerBg: 'bg-yellow-500/10 dark:bg-yellow-500/20',
      headerText: 'text-yellow-600 dark:text-yellow-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-yellow-200 dark:border-yellow-800',
      badge: {
        bg: 'bg-yellow-100',
        text: 'text-yellow-700',
        border: 'border-yellow-300',
        darkBg: 'dark:bg-yellow-950/50'
      }
    }
  }),

  // Network extras
  def({
    type: 'url',
    kind: 'entity',
    label: 'URL',
    category: 'Network',
    iconKey: 'link',
    icon: IconLink,
    manualAdd: true,
    colorHex: '#2dd4bf',
    ui: {
      headerBg: 'bg-teal-500/10 dark:bg-teal-500/20',
      headerText: 'text-teal-600 dark:text-teal-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-teal-200 dark:border-teal-800',
      badge: {
        bg: 'bg-teal-100',
        text: 'text-teal-700',
        border: 'border-teal-300',
        darkBg: 'dark:bg-teal-950/50'
      }
    },
    defaults: {
      initialSize: { width: 180, height: 80 }
    }
  }),
  def({
    type: 'dns_record',
    kind: 'entity',
    label: 'DNS Record',
    category: 'Network',
    iconKey: 'network',
    icon: IconNetwork,
    manualAdd: true,
    colorHex: '#14b8a6',
    ui: {
      headerBg: 'bg-teal-500/10 dark:bg-teal-500/20',
      headerText: 'text-teal-600 dark:text-teal-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-teal-200 dark:border-teal-800',
      badge: {
        bg: 'bg-teal-100',
        text: 'text-teal-700',
        border: 'border-teal-300',
        darkBg: 'dark:bg-teal-950/50'
      }
    }
  }),
  def({
    type: 'hostname',
    kind: 'entity',
    label: 'Hostname',
    category: 'Infrastructure',
    subcategory: 'Network',
    iconKey: 'server-bolt',
    icon: IconServerBolt,
    manualAdd: true,
    colorHex: '#34d399',
    ui: {
      headerBg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
      headerText: 'text-emerald-600 dark:text-emerald-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-emerald-200 dark:border-emerald-800',
      badge: {
        bg: 'bg-emerald-100',
        text: 'text-emerald-700',
        border: 'border-emerald-300',
        darkBg: 'dark:bg-emerald-950/50'
      }
    }
  }),
  def({
    type: 'subdomain',
    kind: 'entity',
    label: 'Subdomain',
    category: 'Infrastructure',
    subcategory: 'Network',
    iconKey: 'world-www',
    icon: IconWorldWww,
    manualAdd: true,
    colorHex: '#34d399',
    ui: {
      headerBg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
      headerText: 'text-emerald-600 dark:text-emerald-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-emerald-200 dark:border-emerald-800',
      badge: {
        bg: 'bg-emerald-100',
        text: 'text-emerald-700',
        border: 'border-emerald-300',
        darkBg: 'dark:bg-emerald-950/50'
      }
    }
  }),
  def({
    type: 'asn',
    kind: 'entity',
    label: 'ASN',
    category: 'Infrastructure',
    subcategory: 'Network',
    iconKey: 'network',
    icon: IconNetwork,
    manualAdd: true,
    colorHex: '#2dd4bf',
    ui: {
      headerBg: 'bg-teal-500/10 dark:bg-teal-500/20',
      headerText: 'text-teal-600 dark:text-teal-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-teal-200 dark:border-teal-800',
      badge: {
        bg: 'bg-teal-100',
        text: 'text-teal-700',
        border: 'border-teal-300',
        darkBg: 'dark:bg-teal-950/50'
      }
    }
  }),
  def({
    type: 'cidr',
    kind: 'entity',
    label: 'CIDR',
    category: 'Infrastructure',
    subcategory: 'Network',
    iconKey: 'network',
    icon: IconNetwork,
    manualAdd: true,
    colorHex: '#38bdf8',
    ui: {
      headerBg: 'bg-sky-500/10 dark:bg-sky-500/20',
      headerText: 'text-sky-600 dark:text-sky-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-sky-200 dark:border-sky-800',
      badge: {
        bg: 'bg-sky-100',
        text: 'text-sky-700',
        border: 'border-sky-300',
        darkBg: 'dark:bg-sky-950/50'
      }
    }
  }),
  def({
    type: 'mac_address',
    kind: 'entity',
    label: 'MAC Address',
    category: 'Infrastructure',
    subcategory: 'Network',
    iconKey: 'device-mobile',
    icon: IconDeviceMobile,
    manualAdd: true,
    colorHex: '#22d3ee',
    ui: {
      headerBg: 'bg-cyan-500/10 dark:bg-cyan-500/20',
      headerText: 'text-cyan-600 dark:text-cyan-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-cyan-200 dark:border-cyan-800',
      badge: {
        bg: 'bg-cyan-100',
        text: 'text-cyan-700',
        border: 'border-cyan-300',
        darkBg: 'dark:bg-cyan-950/50'
      }
    }
  }),
  def({
    type: 'device_id',
    kind: 'entity',
    label: 'Device ID',
    category: 'Infrastructure',
    subcategory: 'Device',
    iconKey: 'cpu',
    icon: IconCpu,
    manualAdd: true,
    colorHex: '#a8a29e',
    ui: {
      headerBg: 'bg-stone-500/10 dark:bg-stone-500/20',
      headerText: 'text-stone-600 dark:text-stone-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-stone-200 dark:border-stone-800',
      badge: {
        bg: 'bg-stone-100',
        text: 'text-stone-700',
        border: 'border-stone-300',
        darkBg: 'dark:bg-stone-950/50'
      }
    }
  }),
  def({
    type: 'user_id',
    kind: 'entity',
    label: 'User ID',
    category: 'Identity',
    subcategory: 'Identifiers',
    iconKey: 'id',
    icon: IconId,
    manualAdd: true,
    colorHex: '#f472b6',
    ui: {
      headerBg: 'bg-pink-500/10 dark:bg-pink-500/20',
      headerText: 'text-pink-600 dark:text-pink-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-pink-200 dark:border-pink-800',
      badge: {
        bg: 'bg-pink-100',
        text: 'text-pink-700',
        border: 'border-pink-300',
        darkBg: 'dark:bg-pink-950/50'
      }
    }
  }),
  def({
    type: 'ssl_certificate',
    kind: 'entity',
    label: 'SSL Certificate',
    category: 'Security',
    subcategory: 'Web',
    iconKey: 'certificate',
    icon: IconCertificate,
    manualAdd: true,
    colorHex: '#8b5cf6',
    ui: {
      headerBg: 'bg-fuchsia-500/10 dark:bg-fuchsia-500/20',
      headerText: 'text-fuchsia-600 dark:text-fuchsia-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-fuchsia-200 dark:border-fuchsia-800',
      badge: {
        bg: 'bg-fuchsia-100',
        text: 'text-fuchsia-700',
        border: 'border-fuchsia-300',
        darkBg: 'dark:bg-fuchsia-950/50'
      }
    }
  }),
  def({
    type: 'whois_record',
    kind: 'entity',
    label: 'WHOIS Record',
    category: 'Security',
    subcategory: 'Web',
    iconKey: 'database-search',
    icon: IconDatabaseSearch,
    manualAdd: true,
    colorHex: '#94a3b8',
    ui: {
      headerBg: 'bg-slate-500/10 dark:bg-slate-500/20',
      headerText: 'text-slate-600 dark:text-slate-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-slate-200 dark:border-slate-800',
      badge: {
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        border: 'border-slate-300',
        darkBg: 'dark:bg-slate-950/50'
      }
    }
  }),
  def({
    type: 'http_request',
    kind: 'entity',
    label: 'HTTP Request',
    category: 'Infrastructure',
    subcategory: 'Web',
    iconKey: 'lock',
    icon: IconLock,
    manualAdd: true,
    colorHex: '#2dd4bf',
    ui: {
      headerBg: 'bg-teal-500/10 dark:bg-teal-500/20',
      headerText: 'text-teal-600 dark:text-teal-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-teal-200 dark:border-teal-800',
      badge: {
        bg: 'bg-teal-100',
        text: 'text-teal-700',
        border: 'border-teal-300',
        darkBg: 'dark:bg-teal-950/50'
      }
    },
    defaults: { isResizable: true, initialSize: { width: 360, height: 220 } }
  }),
  def({
    type: 'http_response',
    kind: 'entity',
    label: 'HTTP Response',
    category: 'Infrastructure',
    subcategory: 'Web',
    iconKey: 'lock',
    icon: IconLock,
    manualAdd: true,
    colorHex: '#2dd4bf',
    ui: {
      headerBg: 'bg-teal-500/10 dark:bg-teal-500/20',
      headerText: 'text-teal-600 dark:text-teal-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-teal-200 dark:border-teal-800',
      badge: {
        bg: 'bg-teal-100',
        text: 'text-teal-700',
        border: 'border-teal-300',
        darkBg: 'dark:bg-teal-950/50'
      }
    },
    defaults: { isResizable: true, initialSize: { width: 360, height: 220 } }
  }),

  // Finance / Commerce
  def({
    type: 'bank_account',
    kind: 'entity',
    label: 'Bank Account',
    category: 'Finance',
    iconKey: 'building-bank',
    icon: IconBuildingBank,
    manualAdd: true,
    colorHex: '#f59e0b',
    ui: {
      headerBg: 'bg-amber-500/10 dark:bg-amber-500/20',
      headerText: 'text-amber-600 dark:text-amber-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-amber-200 dark:border-amber-800',
      badge: {
        bg: 'bg-amber-100',
        text: 'text-amber-700',
        border: 'border-amber-300',
        darkBg: 'dark:bg-amber-950/50'
      }
    }
  }),
  def({
    type: 'iban',
    kind: 'entity',
    label: 'IBAN',
    category: 'Finance',
    iconKey: 'credit-card',
    icon: IconCreditCard,
    manualAdd: true,
    colorHex: '#f59e0b',
    ui: {
      headerBg: 'bg-amber-500/10 dark:bg-amber-500/20',
      headerText: 'text-amber-600 dark:text-amber-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-amber-200 dark:border-amber-800',
      badge: {
        bg: 'bg-amber-100',
        text: 'text-amber-700',
        border: 'border-amber-300',
        darkBg: 'dark:bg-amber-950/50'
      }
    }
  }),
  def({
    type: 'credit_card',
    kind: 'entity',
    label: 'Card',
    category: 'Finance',
    iconKey: 'credit-card',
    icon: IconCreditCard,
    manualAdd: true,
    colorHex: '#f59e0b',
    ui: {
      headerBg: 'bg-amber-500/10 dark:bg-amber-500/20',
      headerText: 'text-amber-600 dark:text-amber-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-amber-200 dark:border-amber-800',
      badge: {
        bg: 'bg-amber-100',
        text: 'text-amber-700',
        border: 'border-amber-300',
        darkBg: 'dark:bg-amber-950/50'
      }
    }
  }),
  def({
    type: 'paypal_account',
    kind: 'entity',
    label: 'PayPal',
    category: 'Finance',
    iconKey: 'credit-card',
    icon: IconCreditCard,
    logoDevDomain: 'paypal.com',
    manualAdd: true,
    colorHex: '#003087',
    ui: {
      headerBg: 'bg-blue-500/10 dark:bg-blue-500/20',
      headerText: 'text-blue-600 dark:text-blue-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-blue-200 dark:border-blue-800',
      badge: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        border: 'border-blue-300',
        darkBg: 'dark:bg-blue-950/50'
      }
    }
  }),
  def({
    type: 'stripe_customer',
    kind: 'entity',
    label: 'Stripe Customer',
    category: 'Finance',
    iconKey: 'credit-card',
    icon: IconCreditCard,
    logoDevDomain: 'stripe.com',
    manualAdd: true,
    colorHex: '#635BFF',
    ui: {
      headerBg: 'bg-indigo-500/10 dark:bg-indigo-500/20',
      headerText: 'text-indigo-600 dark:text-indigo-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-indigo-200 dark:border-indigo-800',
      badge: {
        bg: 'bg-indigo-100',
        text: 'text-indigo-700',
        border: 'border-indigo-300',
        darkBg: 'dark:bg-indigo-950/50'
      }
    }
  }),

  // Security / Breach intel
  def({
    type: 'breach',
    kind: 'entity',
    label: 'Breach',
    category: 'Security',
    subcategory: 'Threat Intel',
    iconKey: 'alert-triangle',
    icon: IconAlertTriangle,
    manualAdd: true,
    colorHex: '#f87171',
    ui: {
      headerBg: 'bg-red-500/10 dark:bg-red-500/20',
      headerText: 'text-red-600 dark:text-red-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-red-200 dark:border-red-800',
      badge: {
        bg: 'bg-red-100',
        text: 'text-red-700',
        border: 'border-red-300',
        darkBg: 'dark:bg-red-950/50'
      }
    }
  }),
  def({
    type: 'leak',
    kind: 'entity',
    label: 'Leak',
    category: 'Security',
    subcategory: 'Threat Intel',
    iconKey: 'alert-triangle',
    icon: IconAlertTriangle,
    manualAdd: true,
    colorHex: '#f87171',
    ui: {
      headerBg: 'bg-red-500/10 dark:bg-red-500/20',
      headerText: 'text-red-600 dark:text-red-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-red-200 dark:border-red-800',
      badge: {
        bg: 'bg-red-100',
        text: 'text-red-700',
        border: 'border-red-300',
        darkBg: 'dark:bg-red-950/50'
      }
    }
  }),

  // AI (not manually addable)
  def({
    type: 'ai_insight',
    kind: 'entity',
    label: 'AI Insight',
    category: 'Analysis',
    iconKey: 'robot',
    icon: IconRobot,
    manualAdd: false,
    colorHex: '#8b5cf6',
    ui: {
      headerBg: 'bg-fuchsia-500/10 dark:bg-fuchsia-500/20',
      headerText: 'text-fuchsia-600 dark:text-fuchsia-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-fuchsia-200 dark:border-fuchsia-800',
      badge: {
        bg: 'bg-fuchsia-100',
        text: 'text-fuchsia-700',
        border: 'border-fuchsia-300',
        darkBg: 'dark:bg-fuchsia-950/50'
      }
    },
    defaults: {
      isResizable: true,
      initialSize: { width: 350, height: 250 }
    }
  }),

  // Misc
  def({
    type: 'custom',
    kind: 'entity',
    label: 'Custom',
    category: 'Other',
    iconKey: 'circle',
    icon: IconCircle,
    manualAdd: true,
    colorHex: '#9ca3af',
    ui: {
      headerBg: 'bg-gray-500/10 dark:bg-gray-500/20',
      headerText: 'text-gray-600 dark:text-gray-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-gray-200 dark:border-gray-800',
      badge: {
        bg: 'bg-gray-100',
        text: 'text-gray-700',
        border: 'border-gray-300',
        darkBg: 'dark:bg-gray-950/50'
      }
    }
  }),

  // UI-only nodes (not part of plugin EntityType)
  def({
    type: 'group',
    kind: 'ui',
    label: 'Group Box',
    category: 'Organization',
    iconKey: 'layout-grid',
    icon: IconLayoutGrid,
    manualAdd: true,
    colorHex: '#6b7280',
    ui: {
      headerBg: 'bg-zinc-500/10 dark:bg-zinc-500/20',
      headerText: 'text-zinc-600 dark:text-zinc-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-zinc-200 dark:border-zinc-800',
      badge: {
        bg: 'bg-zinc-100',
        text: 'text-zinc-700',
        border: 'border-zinc-300',
        darkBg: 'dark:bg-zinc-950/50'
      }
    },
    defaults: {
      isResizable: true,
      initialSize: { width: 400, height: 300 },
      zIndex: -1,
      label: 'Group',
      metadata: {
        groupColor: 'rgba(59, 130, 246, 0.08)',
        groupBorderColor: '#3b82f6',
        labelVisible: true
      }
    }
  }),
  def({
    type: 'text',
    kind: 'ui',
    label: 'Text',
    category: 'Organization',
    iconKey: 'heading',
    icon: IconHeading,
    manualAdd: true,
    colorHex: '#64748b',
    ui: {
      headerBg: 'bg-slate-500/10 dark:bg-slate-500/20',
      headerText: 'text-slate-600 dark:text-slate-400',
      bodyBg: 'bg-white dark:bg-zinc-950',
      borderColor: 'border-slate-200 dark:border-slate-800',
      badge: {
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        border: 'border-slate-300',
        darkBg: 'dark:bg-slate-950/50'
      }
    },
    defaults: {
      isResizable: true,
      initialSize: { width: 200, height: 100 }
    }
  })
] as const satisfies readonly NodeTypeDefinition[];

export const nodeTypeByType: Record<NodeType, NodeTypeDefinition> =
  nodeTypeDefinitions.reduce((acc, d) => {
    acc[d.type] = d;
    return acc;
  }, {} as Record<NodeType, NodeTypeDefinition>);

function getUiLabelForNodeDefinition(
  def: Pick<NodeTypeDefinition, 'label' | 'category' | 'subcategory'>
) {
  if (!def.subcategory) return def.label;

  const shouldPrefixSubcategory =
    def.category === 'Social' ||
    def.category === 'Services' ||
    def.category === 'Communication';

  if (!shouldPrefixSubcategory) return def.label;

  const sub = def.subcategory.trim();
  if (!sub) return def.label;
  if (sub.toLowerCase() === 'generic') return def.label;

  const normalizedLabel = def.label.trim().toLowerCase();
  const normalizedSub = sub.toLowerCase();
  if (normalizedLabel.startsWith(normalizedSub)) return def.label;

  return `${sub} ${def.label}`.trim();
}

export function getNodeTypeUiLabel(type: NodeType) {
  const def = nodeTypeByType[type];
  if (!def) return String(type);
  return getUiLabelForNodeDefinition(def);
}

function buildLogoDevUrl(domain: string): string | null {
  if (!domain) return null;
  const safeDomain = domain.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  if (!safeDomain) return null;

  const url = new URL('/api/logo', 'http://localhost');
  url.searchParams.set('domain', safeDomain);
  url.searchParams.set('size', '256');
  // NOTE: restituiamo path relativo per evitare dipendenze dall'origin.
  return `${url.pathname}${url.search}`;
}

function isLikelyDomain(value: string) {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (!v.includes('.')) return false;
  if (v.length > 253) return false;
  const labels = v.split('.').filter(Boolean);
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
  }
  return true;
}

export function getLogoDevLogoUrl(args: {
  domain: string;
  size?: number;
  theme?: 'auto' | 'light' | 'dark';
  greyscale?: boolean;
  format?: 'png' | 'jpg' | 'webp';
  fallback?: 'monogram' | '404';
  retina?: boolean;
}): string | null {
  // L'endpoint interno si occupa di chiamare Logo.dev, aggiungere token e cache su disco.
  // Qui componiamo solo i parametri minimi necessari.
  const base = buildLogoDevUrl(args.domain);
  if (!base) return null;

  const url = new URL(base, 'http://localhost');
  if (args.size !== undefined) url.searchParams.set('size', String(args.size));
  return `${url.pathname}${url.search}`;
}

export function getLogoUrlForDomain(args: { domain: string; size?: number }) {
  const safeDomain = args.domain.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  if (!isLikelyDomain(safeDomain)) return undefined;
  return (
    getLogoDevLogoUrl({
      domain: safeDomain,
      size: args.size ?? 256
    }) ?? undefined
  );
}

export function getLogoUrlForNodeType(
  type: NodeType,
  args?: { size?: number }
): string | undefined {
  const def = nodeTypeByType[type];
  if (!def?.logoDevDomain) return undefined;

  return (
    getLogoDevLogoUrl({
      domain: def.logoDevDomain,
      size: args?.size ?? 256
    }) ?? undefined
  );
}

export interface NodePaletteItem {
  value: NodeType;
  label: string;
  icon: Icon;
  iconKey: string;
  logoUrl?: string;
  color: string;
  category: string;
  subcategory?: string;
  manualAdd: boolean;
}

export const nodePaletteItems: readonly NodePaletteItem[] = nodeTypeDefinitions.map(
  (d) => ({
    value: d.type,
    label: getUiLabelForNodeDefinition(d),
    icon: d.icon,
    iconKey: d.iconKey,
    logoUrl: d.logoDevDomain ? getLogoDevLogoUrl({ domain: d.logoDevDomain, size: 256 }) ?? undefined : undefined,
    color: d.colorHex,
    category: d.category,
    subcategory: d.subcategory,
    manualAdd: d.manualAdd
  })
);

export function getGroupedPaletteItems() {
  return nodePaletteItems.reduce(
    (acc, option) => {
      if (option.manualAdd === false) return acc;

      const category = option.category || 'Other';
      const subcategory = option.subcategory;

      if (!acc[category]) acc[category] = { _root: [] };

      if (subcategory) {
        if (!acc[category][subcategory]) acc[category][subcategory] = [];
        acc[category][subcategory].push(option);
      } else {
        acc[category]._root.push(option);
      }

      return acc;
    },
    {} as Record<string, Record<string, NodePaletteItem[]>>
  );
}

export function getManuallyAddableNodeTypes(): NodeType[] {
  return nodeTypeDefinitions.filter((d) => d.manualAdd).map((d) => d.type);
}

export interface PublicNodeTypeDefinition {
  type: NodeType;
  kind: NodeKind;
  label: string;
  category: string;
  subcategory?: string;
  iconKey: string;
  logoUrl?: string;
  manualAdd: boolean;
}

export function getPublicNodeTypes(args?: {
  kind?: NodeKind | 'all';
  manualAdd?: boolean;
}): PublicNodeTypeDefinition[] {
  const kind = args?.kind ?? 'all';
  const manualAdd = args?.manualAdd;

  return nodeTypeDefinitions
    .filter((d) => (kind === 'all' ? true : d.kind === kind))
    .filter((d) => (manualAdd === undefined ? true : d.manualAdd === manualAdd))
    .map((d) => ({
      type: d.type,
      kind: d.kind,
      label: getUiLabelForNodeDefinition(d),
      category: d.category,
      subcategory: d.subcategory,
      iconKey: d.iconKey,
      logoUrl: d.logoDevDomain ? buildLogoDevUrl(d.logoDevDomain) ?? undefined : undefined,
      manualAdd: d.manualAdd
    }));
}
