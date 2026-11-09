import * as React from 'react';
import {
  IconFileSearch,
  IconLink,
  IconMail,
  IconMapPin,
  IconPhoto,
  IconRobot,
  IconSparkles,
  IconServer,
  IconSitemap,
  IconVideo,
  IconWallet,
  IconShieldLock,
  IconDatabaseSearch,
  IconTrash,
  IconUserSearch,
  IconMailSearch
} from '@tabler/icons-react';

import { getEntityConfig } from '@/features/graph/config/entity-config';

export interface BuiltInPluginStyle {
  Icon: React.ComponentType<{ className?: string }>;
  logoUrl?: string;
  headerBg: string;
  headerText: string;
}

const BUILTIN_ICON_MAP: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  IconRobot: IconRobot,
  IconSparkles: IconSparkles,
  IconPhoto: IconPhoto,
  IconVideo: IconVideo,
  IconMapPin: IconMapPin,
  IconMail: IconMail,
  IconServer: IconServer,
  IconLink: IconLink,
  IconFileSearch: IconFileSearch,
  IconSitemap: IconSitemap,
  IconWallet: IconWallet,
  IconShieldLock: IconShieldLock,
  IconDatabaseSearch: IconDatabaseSearch,
  IconTrash: IconTrash,
  IconUserSearch: IconUserSearch,
  IconMailSearch: IconMailSearch
};

export function getBuiltInPluginStyle(
  inputTypes: string[],
  pluginIcon?: string,
  logoUrl?: string
) {
  const primaryInput = inputTypes[0] || 'custom';
  const primaryConfig = getEntityConfig(primaryInput);

  const Icon =
    (pluginIcon && BUILTIN_ICON_MAP[pluginIcon]) || primaryConfig.icon;

  const style: BuiltInPluginStyle = {
    Icon,
    logoUrl,
    headerBg: primaryConfig.headerBg,
    headerText: primaryConfig.headerText
  };

  return style;
}
