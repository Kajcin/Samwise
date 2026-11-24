import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';
import { currentUserId } from '../core/current-user';
import { shrinkImage } from '../core/image-resize';
import type { PlantImage } from './plant-lookup.service';

/** Who made a Wikimedia Commons picture and under which licence (shown under it). */
export interface PhotoCredit {
  author: string | null;
  license: string;
  licenseUrl: string | null;
  /** The picture's page on Wikimedia Commons. */
  sourceUrl: string;
}

export interface PlantPhoto {
  id: string;
  plant_id: string;
  kind: 'upload' | 'link' | 'wikimedia';
  storage_path: string | null;
  url: string | null;
  attribution: PhotoCredit | null;
  is_main: boolean;
  created_at: string;
  /** Where to show it from: the link, or a signed URL of the upload (valid for an hour). */
  displayUrl: string;
}

export const PHOTO_BUCKET = 'plant-photos';
/** Signed URLs of uploads last this long; reopening the page makes new ones. */
const SIGNED_URL_SECONDS = 3600;

/**
 * Your photos of a plant (migration 0014): uploads in your folder of the private
 * plant-photos bucket, links shown from their site, and Wikimedia Commons pictures.
 */
@Injectable({ providedIn: 'root' })
export class PlantPhotosService {
  /** Separate so tests can replace it. */
  protected shrink = shrinkImage;

  /** Main photo first, then the newest. */
  async list(plantId: string): Promise<PlantPhoto[]> {
    const { data, error } = await supabase
      .from('plant_photos')
      .select('*')
      .eq('plant_id', plantId)
      .order('is_main', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as Omit<PlantPhoto, 'displayUrl'>[];

    const paths = rows.filter((r) => r.storage_path).map((r) => r.storage_path!);
    const signed = new Map<string, string>();
    if (paths.length) {
      const { data: urls, error: signError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_SECONDS);
      if (signError) throw signError;
      for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
    return rows
      .map((r) => ({ ...r, displayUrl: r.storage_path ? (signed.get(r.storage_path) ?? '') : r.url! }))
      .filter((p) => p.displayUrl);
  }

  /** Shrinks the photo, uploads it to your folder, and adds it to the plant. */
  async upload(plantId: string, file: Blob): Promise<void> {
    const image = await this.shrink(file);
    const userId = await currentUserId();
    const path = `${userId}/${plantId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, image, { contentType: 'image/jpeg' });
    if (uploadError) throw uploadError;
    const { error } = await supabase.from('plant_photos').insert({ plant_id: plantId, kind: 'upload', storage_path: path });
    if (error) {
      await supabase.storage.from(PHOTO_BUCKET).remove([path]); // don't leave an orphan file
      throw error;
    }
  }

  /** A picture shown from its own site; nothing is copied. */
  async addLink(plantId: string, url: string): Promise<void> {
    const { error } = await supabase.from('plant_photos').insert({ plant_id: plantId, kind: 'link', url });
    if (error) throw error;
  }

  /** A Wikimedia Commons picture found by the plant lookup, with its credit. */
  async addWikimedia(plantId: string, image: PlantImage): Promise<void> {
    const attribution: PhotoCredit = {
      author: image.author,
      license: image.license,
      licenseUrl: image.licenseUrl,
      sourceUrl: image.sourceUrl,
    };
    const { error } = await supabase
      .from('plant_photos')
      .insert({ plant_id: plantId, kind: 'wikimedia', url: image.url, attribution });
    if (error) throw error;
  }

  async setMain(photoId: string): Promise<void> {
    const { error } = await supabase.rpc('set_main_plant_photo', { p_photo_id: photoId });
    if (error) throw error;
  }

  /** Removes the photo; an upload's file is deleted too. */
  async remove(photo: Pick<PlantPhoto, 'id' | 'storage_path'>): Promise<void> {
    const { error } = await supabase.from('plant_photos').delete().eq('id', photo.id);
    if (error) throw error;
    if (photo.storage_path) await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
  }

  /** The files of your uploads of a plant (to delete them with the plant). */
  async uploadPaths(plantId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('plant_photos')
      .select('storage_path')
      .eq('plant_id', plantId)
      .not('storage_path', 'is', null);
    if (error) throw error;
    return (data ?? []).map((r) => r.storage_path as string);
  }

  async removeFiles(paths: string[]): Promise<void> {
    if (paths.length) await supabase.storage.from(PHOTO_BUCKET).remove(paths);
  }
}
