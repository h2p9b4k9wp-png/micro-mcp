import { loadUserScopedItem, saveUserScopedItem } from '@/lib/storage/user-scoped';

const BLOCK_STATE_KEY = 'mcp_blocks_state';

export function loadBlockState(userId: string) {
  return loadUserScopedItem<{ id: string; active: boolean }[]>(userId, BLOCK_STATE_KEY);
}

export function saveBlockState(userId: string, blocks: { id: string; active: boolean }[]) {
  saveUserScopedItem(userId, BLOCK_STATE_KEY, blocks);
}
