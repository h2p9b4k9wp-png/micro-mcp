import type { LucideIcon } from 'lucide-react';

export interface McpBlock {
  id: string;
  name: string;
  description: string;
  active: boolean;
  icon: LucideIcon;
  config?: {
    apiKey?: string;
    endpoint?: string;
    statusText?: string;
  };
}
