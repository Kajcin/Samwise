import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { SpinnerComponent } from '../core/loading/spinner.component';
import { LoadingComponent } from '../core/loading/loading.component';
import { ModalComponent } from '../core/modal/modal.component';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { LanguageService } from '../core/i18n/language.service';
import { Message, msg } from '../core/i18n/i18n';
import { messageOf } from '../core/errors';
import { isWebAddress } from '../core/web-address';
import { UnreadableImageError } from '../core/image-resize';
import { FunctionError } from '../core/edge-functions';
import { environment } from '../../environments/environment';
import { PlantPhoto, PlantPhotosService } from './plant-photos.service';
import { PlantCandidate, PlantLookupService } from './plant-lookup.service';
import type { IconName } from '../core/icons/icons.generated';

export type PhotoSource = 'upload' | 'link' | 'wikipedia';

/** "Nepeta racemosa 'Walker's Low'" → "Nepeta racemosa": Wikipedia knows species, not cultivars. */
export function wikipediaQuery(species: string | null | undefined, name: string): string {
  // The cultivar comes last and may itself contain an apostrophe ('Walker's Low').
  const latin = (species ?? '').replace(/\s*'.*$/, '').replace(/\s+/g, ' ').trim();
  return latin || name;
}

/** "www.loukykvet.cz" for a link's credit. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * A plant's photos on its page: the one being viewed large (the main photo at first) with
 * its credit, thumbnails of the others, and adding (upload, link, Wikipedia), choosing the
 * main photo and deleting. Photos are the signed-in user's own, also on built-in plants.
 */
@Component({
  selector: 'app-plant-photos',
  imports: [IconComponent, ModalComponent, SpinnerComponent, LoadingComponent],
  templateUrl: './plant-photos.component.html',
  styles: `
    .photo-placeholder {
      background: linear-gradient(160deg, #f4f7ec, #e2ecd2);
    }
    .photo-placeholder-icon {
      font-size: 4.5rem;
      opacity: 0.6;
    }
    .thumb {
      width: 3.5rem;
      height: 3.5rem;
      padding: 0;
      border: 2px solid transparent;
      border-radius: 0.4rem;
      overflow: hidden;
      position: relative;
    }
    .thumb[aria-pressed='true'] {
      border-color: var(--bs-primary);
    }
    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .thumb .main-star {
      position: absolute;
      right: 2px;
      bottom: 0;
      color: #fff;
      text-shadow: 0 0 2px #000;
      font-size: 0.8rem;
    }
    .candidate-image {
      width: 6rem;
      height: 4.5rem;
      object-fit: cover;
      border-radius: 0.4rem;
    }
  `,
})
export class PlantPhotosComponent {
  plantId = input.required<string>();
  /** For alt texts. */
  plantName = input.required<string>();
  /** The plant's Latin name, to find its picture on Wikipedia. */
  species = input<string | null>(null);

  protected i18n = inject(LanguageService);
  private photosService = inject(PlantPhotosService);
  private lookupService = inject(PlantLookupService);
  private confirmDialog = inject(ConfirmDialogService);
  protected readonly hostOf = hostOf;

  photos = signal<PlantPhoto[]>([]);
  loading = signal(true);
  error = signal<Message | null>(null);
  busy = signal(false);
  /** Photos whose picture didn't load (e.g. a link to a page that's gone). */
  broken = signal<ReadonlySet<string>>(new Set());
  private viewedId = signal<string | null>(null);
  viewed = computed(() => this.photos().find((p) => p.id === this.viewedId()) ?? this.photos()[0] ?? null);

  // The "add a photo" dialog.
  dialogOpen = signal(false);
  source = signal<PhotoSource>('upload');
  files = signal<File[]>([]);
  progress = signal<{ done: number; total: number } | null>(null);
  linkUrl = signal('');
  dialogError = signal<Message[] | null>(null);
  wikiResults = signal<PlantCandidate[] | null>(null);
  wikiLoading = signal(false);
  protected readonly sources: { id: PhotoSource; label: string; icon: IconName }[] = [
    { id: 'upload', label: 'photos.tabUpload', icon: 'upload' },
    { id: 'link', label: 'photos.tabLink', icon: 'link-45deg' },
    { id: 'wikipedia', label: 'photos.tabWikipedia', icon: 'search' },
  ];

  constructor() {
    effect(() => {
      const plantId = this.plantId();
      untracked(() => {
        this.viewedId.set(null);
        this.load(plantId);
      });
    });
  }

  private async load(plantId = this.plantId()): Promise<void> {
    this.loading.set(true);
    try {
      this.photos.set(await this.photosService.list(plantId));
      this.error.set(null);
    } catch (e) {
      this.error.set(msg('photos.errors.load', { detail: messageOf(e) }));
    } finally {
      this.loading.set(false);
    }
  }

  view(photo: PlantPhoto): void {
    this.viewedId.set(photo.id);
  }

  markBroken(photoId: string): void {
    this.broken.update((set) => new Set(set).add(photoId));
  }

  async setMain(photo: PlantPhoto): Promise<void> {
    await this.run(() => this.photosService.setMain(photo.id), 'photos.errors.save');
    this.viewedId.set(photo.id);
  }

  async deletePhoto(photo: PlantPhoto): Promise<void> {
    const confirmed = await this.confirmDialog.ask({
      title: this.i18n.t('photos.deleteTitle'),
      message: this.i18n.t('photos.deleteMessage'),
      confirmLabel: this.i18n.t('plant.deleteConfirm'),
      cancelLabel: this.i18n.t('common.cancel'),
      danger: true,
      confirmIcon: 'trash',
    });
    if (!confirmed) return;
    await this.run(() => this.photosService.remove(photo), 'photos.errors.delete');
    this.viewedId.set(null);
  }

  /** Runs a change, then reloads the photos; a failure shows under the picture. */
  private async run(change: () => Promise<unknown>, errorKey: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await change();
    } catch (e) {
      this.error.set(msg(errorKey, { detail: messageOf(e) }));
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  // --- The "add a photo" dialog ----------------------------------------------------------

  openDialog(): void {
    this.source.set('upload');
    this.files.set([]);
    this.progress.set(null);
    this.linkUrl.set('');
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    if (this.progress()) return; // let an upload finish
    this.dialogOpen.set(false);
  }

  chooseSource(source: PhotoSource): void {
    this.source.set(source);
    this.dialogError.set(null);
    if (source === 'wikipedia' && !this.wikiResults() && !this.wikiLoading()) this.searchWikipedia();
  }

  onFilesChosen(input: HTMLInputElement): void {
    this.files.set(Array.from(input.files ?? []));
    this.dialogError.set(null);
  }

  /** Submits the current tab: uploads the chosen files, or adds the link. */
  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.source() === 'upload') await this.uploadFiles();
    else if (this.source() === 'link') await this.addLink();
  }

  private async uploadFiles(): Promise<void> {
    const files = this.files();
    if (!files.length) return this.dialogError.set([msg('photos.errors.noFiles')]);
    this.dialogError.set(null);
    const failed: Message[] = [];
    for (const [i, file] of files.entries()) {
      this.progress.set({ done: i, total: files.length });
      try {
        await this.photosService.upload(this.plantId(), file);
      } catch (e) {
        failed.push(
          e instanceof UnreadableImageError
            ? msg('photos.errors.unreadable', { file: file.name })
            : msg('photos.errors.upload', { file: file.name, detail: messageOf(e) }),
        );
      }
    }
    this.progress.set(null);
    await this.load();
    if (failed.length) this.dialogError.set(failed);
    else this.dialogOpen.set(false);
  }

  private async addLink(): Promise<void> {
    const url = this.linkUrl().trim();
    if (!isWebAddress(url)) return this.dialogError.set([msg('photos.errors.linkInvalid')]);
    try {
      await this.photosService.addLink(this.plantId(), url);
    } catch (e) {
      return this.dialogError.set([msg('photos.errors.save', { detail: messageOf(e) })]);
    }
    this.dialogOpen.set(false);
    await this.load();
  }

  async searchWikipedia(): Promise<void> {
    this.wikiLoading.set(true);
    this.dialogError.set(null);
    try {
      const found = await this.lookupService.lookup(wikipediaQuery(this.species(), this.plantName()), this.i18n.lang());
      this.wikiResults.set(found.filter((c) => c.image));
    } catch (e) {
      const unreachable = e instanceof FunctionError && e.code === 'unreachable';
      this.dialogError.set(
        unreachable
          ? [msg('lookup.errors.unreachable'), ...(environment.production ? [] : [msg('settings.calendar.errors.devHint')])]
          : [msg('lookup.errors.failed')],
      );
    } finally {
      this.wikiLoading.set(false);
    }
  }

  async useWikipediaImage(candidate: PlantCandidate): Promise<void> {
    if (!candidate.image) return;
    try {
      await this.photosService.addWikimedia(this.plantId(), candidate.image);
    } catch (e) {
      return this.dialogError.set([msg('photos.errors.save', { detail: messageOf(e) })]);
    }
    this.dialogOpen.set(false);
    await this.load();
  }
}
