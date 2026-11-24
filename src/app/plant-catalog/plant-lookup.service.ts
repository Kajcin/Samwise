import { Injectable } from '@angular/core';
import { invokeFunction } from '../core/edge-functions';
import type { Lang } from '../core/i18n/i18n';

/** A free picture of the plant from Wikimedia Commons, with what's needed to credit it. */
export interface PlantImage {
  url: string;
  author: string | null;
  license: string;
  licenseUrl: string | null;
  /** The picture's page on Wikimedia Commons. */
  sourceUrl: string;
}

export type TaxonRank = 'family' | 'genus' | 'species' | 'hybrid' | 'subspecies' | 'variety' | 'cultivar';

/** A plant found on Wikipedia (see supabase/functions/plant-lookup/lookup.ts). */
export interface PlantCandidate {
  wikidataId: string;
  /** Suggested name: the article's, or the searched words for a cultivar ("Šanta Walker's Low"). */
  name: string;
  latinName: string;
  rank: TaxonRank | null;
  /** Searched words the found plant doesn't account for, e.g. "Walker's Low". */
  cultivar: string | null;
  articleTitle: string;
  description: string;
  url: string;
  /** The Wikipedia it came from. */
  language: Lang;
  /** The article's free main picture; null if none (or its licence is unknown). */
  image?: PlantImage | null;
}

@Injectable({ providedIn: 'root' })
export class PlantLookupService {
  /** Plants on Wikipedia for a search, best first; throws FunctionError (`unreachable`, `lookup_failed`, …). */
  async lookup(query: string, language: Lang): Promise<PlantCandidate[]> {
    const data = await invokeFunction<{ candidates?: PlantCandidate[] }>(
      'plant-lookup',
      { query, language },
      'lookup_failed',
    );
    return data?.candidates ?? [];
  }
}
