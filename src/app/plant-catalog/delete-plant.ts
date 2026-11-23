import type { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import type { LanguageService } from '../core/i18n/language.service';

/** The same question wherever a plant can be deleted (the catalog's ✕, the plant page's trash). */
export function askToDeletePlant(dialog: ConfirmDialogService, i18n: LanguageService, name: string): Promise<boolean> {
  return dialog.ask({
    title: i18n.t('plant.deleteTitle'),
    message: i18n.t('plant.deleteMessage', { name }),
    confirmLabel: i18n.t('plant.deleteConfirm'),
    cancelLabel: i18n.t('common.cancel'),
    danger: true,
    confirmIcon: 'trash',
  });
}
