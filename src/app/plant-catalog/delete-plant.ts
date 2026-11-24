import type { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { Message, msg } from '../core/i18n/i18n';
import type { LanguageService } from '../core/i18n/language.service';
import type { PlantCatalogService } from './plant-catalog.service';

/** What came of asking to delete a plant. */
export type PlantDeletionDecision = { kind: 'confirmed' } | { kind: 'cancelled' } | { kind: 'blocked'; message: Message };

/** "This plant is in the bed Herbs right now. Remove it from the garden first…" */
export function inGardenMessage(beds: readonly string[]): Message {
  return msg('plant.errors.inGarden', { count: beds.length, beds: beds.join(', ') });
}

/**
 * The same steps wherever a plant can be deleted (the catalog's ✕, the plant page's trash):
 * a plant in a bed right now can't be deleted (the message says where); otherwise the
 * usual question, mentioning the completed tasks of past plantings that go with it.
 * Rejects if the check fails.
 */
export async function decidePlantDeletion(
  catalog: PlantCatalogService,
  dialog: ConfirmDialogService,
  i18n: LanguageService,
  plantId: string,
  name: string,
): Promise<PlantDeletionDecision> {
  const check = await catalog.deletionCheck(plantId);
  if (check.activeBeds.length) return { kind: 'blocked', message: inGardenMessage(check.activeBeds) };
  const history = check.completedTasks ? ' ' + i18n.t('plant.deleteHistory', { count: check.completedTasks }) : '';
  const confirmed = await dialog.ask({
    title: i18n.t('plant.deleteTitle'),
    message: i18n.t('plant.deleteMessage', { name }) + history,
    confirmLabel: i18n.t('plant.deleteConfirm'),
    cancelLabel: i18n.t('common.cancel'),
    danger: true,
    confirmIcon: 'trash',
  });
  return { kind: confirmed ? 'confirmed' : 'cancelled' };
}
